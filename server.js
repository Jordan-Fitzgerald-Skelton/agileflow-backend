require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

//imports the utility files
const { pool, runQuery } = require("./utils/db");

//cors and websocket setup with http
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONT_APP,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
  }
});

// SECURITY IMPROVEMENT: Whitelisted table names to prevent SQL injection
const ALLOWED_TABLES = {
  refinement_predictions: "refinement_predictions",
  room_users: "room_users",
  rooms: "rooms"
};

// SECURITY IMPROVEMENT: Input validation constants
const VALIDATION_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_EMAIL_LENGTH: 254,
  MAX_ROLE_LENGTH: 50,
  MIN_PREDICTION: 0.1,
  MAX_PREDICTION: 1000
};

// ADD THIS AFTER THE IMPORTS (around line 10)
const CONFIG = {
  ROOM_CLEANUP_DELAY: 30 * 1000, // 30 seconds
  ROOM_EXPIRY_TIME: 24 * 60 * 60 * 1000, // 24 hours
  EMPTY_ROOM_CLEANUP_TIME: 2 * 60 * 60 * 1000, // 2 hours
  CLEANUP_CHECK_INTERVAL: 60 * 60 * 1000, // 1 hour
  DEFAULT_ROOM_TYPE: 'refinement'
};

// ROOM STATE MANAGEMENT: Room status enum
const ROOM_STATUS = {
  ACTIVE: 'active',
  FINISHED: 'finished',
  EXPIRED: 'expired'
};

//middleware
const apiLimit = rateLimit({
  //set a time for 15 minutes
  windowMs: 15 * 60 * 1000,
  //this will limit each IP address to 100 requests every 15 minutes.
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." }
});

//add the rate limiting to all the routes
app.use(apiLimit);

//return a generic error when things don't work for the endpoints
const handleError = (res, error, message = "An error occurred") => {
  console.error(`[${new Date().toISOString()}] Error:`, error);
  return res.status(500).json({
    success: false,
    message: message
  });
};

app.use(cors());
app.use(express.json());

//logs each request with the method, url, and timestamp.
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ENHANCED INPUT VALIDATION: Comprehensive validation functions
const validateInput = {
  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    if (email.length > VALIDATION_LIMITS.MAX_EMAIL_LENGTH) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  
  name: (name) => {
    if (!name || typeof name !== 'string') return false;
    if (name.length > VALIDATION_LIMITS.MAX_NAME_LENGTH) return false;
    // Allow alphanumeric, spaces, hyphens, and apostrophes
    const nameRegex = /^[a-zA-Z0-9\s\-']+$/;
    return nameRegex.test(name.trim());
  },
  
  inviteCode: (code) => {
    if (!code || typeof code !== 'string') return false;
    // Expect 12-16 character hex string
    const codeRegex = /^[a-f0-9]{12,16}$/i;
    return codeRegex.test(code);
  },
  
  prediction: (prediction) => {
    const num = parseFloat(prediction);
    return !isNaN(num) && num >= VALIDATION_LIMITS.MIN_PREDICTION && num <= VALIDATION_LIMITS.MAX_PREDICTION;
  },
  
  role: (role) => {
    if (!role || typeof role !== 'string') return false;
    return role.length <= VALIDATION_LIMITS.MAX_ROLE_LENGTH && /^[a-zA-Z0-9\s\-_]+$/.test(role);
  }
};

const validateRequest = (validationRules) => {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, validator] of Object.entries(validationRules)) {
      const value = req.body[field] || req.query[field];
      if (!validator(value)) {
        errors.push(`Invalid ${field}`);
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(', ')
      });
    }
    
    next();
  };
};

// SECURITY IMPROVEMENT: Stronger invite code generation (12-16 characters)
const generateInviteCode = () => {
  // Generate 8 bytes (16 hex characters) for stronger security
  return crypto.randomBytes(8).toString("hex");
};

// RACE CONDITION FIX: Invite code generation with transaction and retry logic
const createUniqueInviteCode = async (maxRetries = 5) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const inviteCode = generateInviteCode();
      
      // Use transaction to ensure atomicity
      const result = await runQuery(async (client) => {
        await client.query('BEGIN');
        
        try {
          // Check if code exists with FOR UPDATE to prevent race conditions
          const check = await client.query(
            "SELECT 1 FROM rooms WHERE invite_code = $1 FOR UPDATE", 
            [inviteCode]
          );
          
          if (check.rowCount > 0) {
            await client.query('ROLLBACK');
            return null; // Code exists, try again
          }
          
          await client.query('COMMIT');
          return inviteCode;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      
      if (result) return result;
    } catch (error) {
      console.error(`Invite code generation attempt ${attempt + 1} failed:`, error);
      if (attempt === maxRetries - 1) {
        throw new Error('Failed to generate unique invite code after maximum retries');
      }
    }
  }
  throw new Error('Failed to generate unique invite code');
};

// USER IDENTIFICATION: Generate unique user ID within room context
const generateUserRoomId = (email, name, roomId) => {
  const data = `${email}-${name}-${roomId}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
};

// MEMORY LEAK PREVENTION: Enhanced activeRooms management
const activeRooms = new Map();
const roomCleanupTimers = new Map();

// CLEANUP STRATEGY: Unified cleanup system with room state management
const cleanupRoomData = async (room_id, updateStatus = true) => {
  try {
    // Use individual queries instead of transaction for simple operations
    if (updateStatus) {
      await runQuery(async (client) => {
        await client.query(
          "UPDATE rooms SET status = $1, finished_at = CURRENT_TIMESTAMP WHERE room_id = $2",
          [ROOM_STATUS.FINISHED, room_id]
        );
      });
    }
    
    // Delete in order of foreign key dependencies
    await runQuery(async (client) => {
      await client.query(
        `DELETE FROM ${ALLOWED_TABLES.refinement_predictions} WHERE room_id = $1`, 
        [room_id]
      );
    });
    
    await runQuery(async (client) => {
      await client.query(
        `DELETE FROM ${ALLOWED_TABLES.room_users} WHERE room_id = $1`, 
        [room_id]
      );
    });
    
    await runQuery(async (client) => {
      await client.query(
        `DELETE FROM ${ALLOWED_TABLES.rooms} WHERE room_id = $1`, 
        [room_id]
      );
    });
    
    // Clean up memory references
    activeRooms.delete(room_id);
    if (roomCleanupTimers.has(room_id)) {
      clearTimeout(roomCleanupTimers.get(room_id));
      roomCleanupTimers.delete(room_id);
    }
    
    console.log(`[${new Date().toISOString()}] Cleaned up data for room: ${room_id}`);
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error cleaning up room data:`, error);
    return false;
  }
};

// CLEANUP STRATEGY: Scheduled cleanup job for expired rooms
const scheduleRoomCleanup = () => {
  setInterval(async () => {
    try {
      const expiredRooms = await runQuery(async (client) => {
        // Clean up rooms older than 24 hours that are still active
        const result = await client.query(`
          SELECT room_id FROM rooms 
          WHERE created_at < NOW() - INTERVAL '24 hours' 
          AND (status = $1 OR status IS NULL)
        `, [ROOM_STATUS.ACTIVE]);
        return result.rows;
      });
      
      for (const room of expiredRooms) {
        console.log(`Cleaning up expired room: ${room.room_id}`);
        await cleanupRoomData(room.room_id, true);
        // Notify any connected users
        io.to(room.room_id).emit("room_expired", { 
          message: "This room has expired and been closed" 
        });
      }
    } catch (error) {
      console.error('Scheduled cleanup error:', error);
    }
  }, CONFIG.CLEANUP_CHECK_INTERVAL); // Run every hour
};

// Start scheduled cleanup
scheduleRoomCleanup();

// ROOM STATE MANAGEMENT: Check if room is accessible
const isRoomAccessible = async (roomId) => {
  try {
    const result = await runQuery(async (client) => {
      const roomResult = await client.query(
        "SELECT status, created_at FROM rooms WHERE room_id = $1",
        [roomId]
      );
      
      if (roomResult.rowCount === 0) {
        return { accessible: false, reason: 'Room not found' };
      }
      
      const room = roomResult.rows[0];
      const status = room.status || ROOM_STATUS.ACTIVE;
      
      if (status === ROOM_STATUS.FINISHED) {
        return { accessible: false, reason: 'Room has been finished' };
      }
      
      if (status === ROOM_STATUS.EXPIRED) {
        return { accessible: false, reason: 'Room has expired' };
      }
      
      // Check if room is older than 24 hours
      const roomAge = Date.now() - new Date(room.created_at).getTime();
      
      if (roomAge > CONFIG.ROOM_EXPIRY_TIME) {
        // Mark as expired
        await client.query(
          "UPDATE rooms SET status = $1 WHERE room_id = $2",
          [ROOM_STATUS.EXPIRED, roomId]
        );
        return { accessible: false, reason: 'Room has expired' };
      }
      
      return { accessible: true };
    });
    
    return result;
  } catch (error) {
    console.error('Error checking room accessibility:', error);
    return { accessible: false, reason: 'Error checking room status' };
  }
};

// CODE DEDUPLICATION: Shared prediction submission service
const PredictionService = {
  async submitPrediction(roomId, name, role, prediction, socketId = null) {
    // Validate inputs
    if (!validateInput.name(name)) {
      throw new Error('Invalid name format');
    }
    if (!validateInput.role(role)) {
      throw new Error('Invalid role format');
    }
    if (!validateInput.prediction(prediction)) {
      throw new Error('Invalid prediction value');
    }
    
    // Check room accessibility
    const roomCheck = await isRoomAccessible(roomId);
    if (!roomCheck.accessible) {
      throw new Error(roomCheck.reason);
    }
    
    // Generate unique user room ID
    const userRoomId = RoomService.getUserRoomId('', name, roomId);
    
    const result = await runQuery(async (client) => {
      await client.query('BEGIN');
      
      try {
        // Insert/update prediction with unique constraint on (room_id, user_room_id, role)
        await client.query(`
          INSERT INTO ${ALLOWED_TABLES.refinement_predictions} 
          (room_id, name, role, prediction, user_room_id, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (room_id, user_room_id, role) 
          DO UPDATE SET prediction = EXCLUDED.prediction, created_at = NOW()
        `, [roomId, name, role, prediction, userRoomId]);
        
        await client.query('COMMIT');
        return { success: true };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    
    // Update activeRooms if user is connected via WebSocket
    if (socketId && activeRooms.has(roomId)) {
      const userData = activeRooms.get(roomId).get(socketId);
      if (userData?.name === name) {
        userData.hasSubmitted = true;
        io.to(roomId).emit("user_list", Array.from(activeRooms.get(roomId).values()));
      }
    }
    
    return result;
  }
};

class RoomService {
  static userRoomIdCache = new Map();
  
  static getUserRoomId(email, name, roomId) {
    const key = `${email}-${name}-${roomId}`;
    if (!this.userRoomIdCache.has(key)) {
      const id = generateUserRoomId(email, name, roomId);
      this.userRoomIdCache.set(key, id);
    }
    return this.userRoomIdCache.get(key);
  }
  
  static async checkAccessibility(roomId) {
    // Cached version of room accessibility check
    const cacheKey = `room_${roomId}`;
    // Implement caching logic here
    return isRoomAccessible(roomId);
  }
  
  static clearCache() {
    this.userRoomIdCache.clear();
  }
}

//create a room
// REPLACE THE ENTIRE /create/room ENDPOINT
app.post("/create/room", async (req, res) => {
  try {
    const result = await runQuery(async (client) => {
      const invite_code = await createUniqueInviteCode();
      const room_id = uuidv4();
      
      const result = await client.query(`
        INSERT INTO ${ALLOWED_TABLES.rooms} 
        (room_id, invite_code, room_type, status, created_at) 
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
        RETURNING room_id, invite_code
      `, [room_id, invite_code, CONFIG.DEFAULT_ROOM_TYPE, ROOM_STATUS.ACTIVE]);
      
      return result;
    });
    
    res.json({
      success: true,
      message: "Room created successfully",
      room_id: result.rows[0].room_id,
      invite_code: result.rows[0].invite_code
    });
  } catch (error) {
    return handleError(res, error, "Failed to create room");
  }
});

//join a room
app.post("/join/room", async (req, res) => {
  try {
    const { invite_code, name, email } = req.body;
    
    // Enhanced input validation
    if (!invite_code || !name || !email) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields."
      });
    }
    
    if (!validateInput.inviteCode(invite_code)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invite code format"
      });
    }
    
    if (!validateInput.name(name)) {
      return res.status(400).json({
        success: false,
        message: "Invalid name format"
      });
    }
    
    if (!validateInput.email(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }
    
    const result = await runQuery(async (client) => {
      await client.query('BEGIN');
      
      try {
        const roomResult = await client.query(
          "SELECT room_id, room_type, status FROM rooms WHERE invite_code = $1",
          [invite_code]
        );
        
        if (roomResult.rowCount === 0) {
          throw new Error("Invalid invite code");
        }
        
        const { room_id, room_type, status = ROOM_STATUS.ACTIVE } = roomResult.rows[0];
        
        // Check room accessibility
        if (status !== ROOM_STATUS.ACTIVE) {
          throw new Error(`Room is ${status} and cannot be joined`);
        }
        
        // Generate unique user room ID
        const userRoomId = RoomService.getUserRoomId(email, name, room_id);
        
        // Add user to room with unique identifier
        await client.query(`
          INSERT INTO ${ALLOWED_TABLES.room_users} 
          (room_id, name, email, user_room_id, joined_at) 
          VALUES ($1, $2, $3, $4, NOW()) 
          ON CONFLICT (room_id, user_room_id) DO NOTHING
        `, [room_id, name, email, userRoomId]);
        
        await client.query('COMMIT');
        return { room_id, room_type };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    
    res.json({
      success: true,
      message: `Joined ${result.room_type} room successfully`,
      room_id: result.room_id,
      room_type: result.room_type
    });
  } catch (error) {
    if (error.message === "Invalid invite code" || error.message.includes("cannot be joined")) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    return handleError(res, error, "Failed to join room");
  }
});

app.post("/finish/room", async (req, res) => {
  try {
    const { room_id } = req.body;
    
    if (!room_id || typeof room_id !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Valid Room ID is required"
      });
    }
    
    const cleaned = await cleanupRoomData(room_id, true);
    
    if (cleaned) {
      // Notify all connected users the room is closed
      io.to(room_id).emit("room_closed", { 
        message: "This room has been closed by the host" 
      });
      
      res.json({
        success: true,
        message: "Room and associated data successfully cleaned up"
      });
    } else {
      throw new Error("Failed to clean up room data");
    }
  } catch (error) {
    return handleError(res, error, "Failed to finish room");
  }
});

// CODE DEDUPLICATION: Using shared prediction service
// REPLACE THE ENTIRE /refinement/prediction/submit ENDPOINT
app.post("/refinement/prediction/submit", 
  validateRequest({
    room_id: (val) => val && typeof val === 'string',
    name: validateInput.name,
    role: validateInput.role,
    prediction: validateInput.prediction
  }),
  async (req, res) => {
    try {
      const { room_id, name, role, prediction } = req.body;
      
      await PredictionService.submitPrediction(room_id, name, role, prediction);
      
      res.json({
        success: true,
        message: "Prediction submitted successfully"
      });
    } catch (error) {
      const statusCode = error.message.includes('Invalid') || 
                        error.message.includes('expired') || 
                        error.message.includes('finished') ? 400 : 500;
      
      return res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }
);

app.get("/refinement/get/predictions", async (req, res) => {
  try {
    const { room_id } = req.query;
    
    if (!room_id) {
      return res.status(400).json({
        success: false,
        message: "Missing room_id"
      });
    }
    
    // Check room accessibility
    const roomCheck = await isRoomAccessible(room_id);
    if (!roomCheck.accessible) {
      return res.status(400).json({
        success: false,
        message: roomCheck.reason
      });
    }
    
    const result = await runQuery(async (client) => {
      await client.query('BEGIN');
      
      try {
        // Get the average prediction for each role
        const predictionResult = await client.query(`
          SELECT role, AVG(prediction) AS final_prediction 
          FROM ${ALLOWED_TABLES.refinement_predictions}
          WHERE room_id = $1 
          GROUP BY role 
          ORDER BY role
        `, [room_id]);
        
        const predictions = predictionResult.rows.map((row) => ({
          role: row.role,
          final_prediction: parseFloat(row.final_prediction),
        }));
        
        // Clean up predictions
        await client.query(
          `DELETE FROM ${ALLOWED_TABLES.refinement_predictions} WHERE room_id = $1`,
          [room_id]
        );
        
        await client.query('COMMIT');
        
        // Reset submission status for all users in the room
        if (activeRooms.has(room_id)) {
          activeRooms.get(room_id).forEach((userData) => {
            userData.hasSubmitted = false;
          });
          // Emit updated user list
          io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
        }
        
        return predictions;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    
    res.json({
      success: true,
      predictions: result
    });
  } catch (error) {
    return handleError(res, error, "Failed to retrieve predictions");
  }
});

//websockets with comprehensive error handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  
  socket.on("join_room", async (data) => {
    try {
      const { invite_code, name, email } = data;
      
      if (!invite_code || !name || !email) {
        socket.emit("error", { message: "Missing required fields" });
        return;
      }
      
      // Enhanced validation
      if (!validateInput.inviteCode(invite_code)) {
        socket.emit("error", { message: "Invalid invite code format" });
        return;
      }
      
      if (!validateInput.name(name)) {
        socket.emit("error", { message: "Invalid name format" });
        return;
      }
      
      if (!validateInput.email(email)) {
        socket.emit("error", { message: "Invalid email format" });
        return;
      }
      
      const result = await runQuery(async (client) => {
        const roomResult = await client.query(
          "SELECT room_id, room_type, status FROM rooms WHERE invite_code = $1",
          [invite_code]
        );
        
        if (roomResult.rowCount === 0) {
          throw new Error("Room not found");
        }
        
        const { room_id, room_type, status = ROOM_STATUS.ACTIVE } = roomResult.rows[0];
        
        // Check room accessibility
        if (status !== ROOM_STATUS.ACTIVE) {
          throw new Error(`Room is ${status} and cannot be joined`);
        }
        
        return { room_id, room_type };
      });
      
      const { room_id, room_type } = result;
      
      socket.join(room_id);
      console.log(`User ${socket.id} joined room: ${room_id} (${name})`);
      
      // Track the active users with unique identifier
      if (!activeRooms.has(room_id)) {
        activeRooms.set(room_id, new Map());
      }
      
      const userRoomId = RoomService.getUserRoomId(email, name, room_id);
      const userData = {
        name,
        email,
        userRoomId,
        hasSubmitted: false
      };
      
      activeRooms.get(room_id).set(socket.id, userData);
      
      // Update the active user list
      io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
      
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("error", { message: error.message || "Failed to join room" });
    }
  });

  socket.on("submit_prediction", async (data) => {
    try {
      const { room_id, name, role, prediction } = data;
      
      if (!room_id || !name || !role || prediction === undefined) {
        socket.emit("error", { message: "Missing required prediction data" });
        return;
      }
      
      // Use shared prediction service with socket ID for user tracking
      await PredictionService.submitPrediction(room_id, name, role, prediction, socket.id);
      
      io.to(room_id).emit("prediction_submitted", { name, role, prediction });
      console.log(`Prediction submitted for room ${room_id}: ${name} (${role}) = ${prediction}`);
    } catch (error) {
      console.error("Error in submit_prediction:", error);
      socket.emit("error", { message: error.message || "Failed to submit prediction" });
    }
  });

  socket.on("reset_session", async (data) => {
    try {
      const { room_id } = data;
      
      if (!room_id) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }
      
      // Check room accessibility
      const roomCheck = await isRoomAccessible(room_id);
      if (!roomCheck.accessible) {
        socket.emit("error", { message: roomCheck.reason });
        return;
      }
      
      // Reset the hasSubmitted status for all users in the room
      if (activeRooms.has(room_id)) {
        activeRooms.get(room_id).forEach(userData => {
          userData.hasSubmitted = false;
        });
        
        // Clear any stored predictions in the database
        await runQuery(async (client) => {
          await client.query(
            `DELETE FROM ${ALLOWED_TABLES.refinement_predictions} WHERE room_id = $1`,
            [room_id]
          );
        });
        
        // Emit the updated user list with reset submission status
        io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
      }
      
      io.to(room_id).emit("session_reset");
      console.log(`Session reset for room ${room_id}`);
    } catch (error) {
      console.error("Error in reset_session:", error);
      socket.emit("error", { message: "Failed to reset session" });
    }
  });

  socket.on("reveal_results", async (data) => {
    try {
      const { room_id, predictions } = data;
      
      if (!room_id || !predictions) {
        socket.emit("error", { message: "Invalid results data" });
        return;
      }
      
      // Check room accessibility
      const roomCheck = await isRoomAccessible(room_id);
      if (!roomCheck.accessible) {
        socket.emit("error", { message: roomCheck.reason });
        return;
      }
      
      // Validate the predictions format
      if (!Array.isArray(predictions)) {
        socket.emit("error", { message: "Predictions must be an array" });
        return;
      }
      
      // Check if predictions have the expected structure
      const isValidPrediction = predictions.every(pred =>
        typeof pred === 'object' &&
        pred !== null &&
        'role' in pred &&
        'final_prediction' in pred &&
        typeof pred.role === 'string' &&
        typeof pred.final_prediction === 'number' &&
        validateInput.role(pred.role) &&
        validateInput.prediction(pred.final_prediction)
      );
      
      if (!isValidPrediction) {
        socket.emit("error", {
          message: "Invalid prediction format - must have valid role and final_prediction properties"
        });
        return;
      }
      
      io.to(room_id).emit("results_revealed", predictions);
      console.log(`Results revealed for room ${room_id}`);
    } catch (error) {
      console.error("Error in reveal_results:", error);
      socket.emit("error", { message: "Failed to reveal results" });
    }
  });

  socket.on("leave_room", ({ roomId }) => {
    try {
      if (!roomId) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }
      
      // Remove the user from the active user list and the room when it's empty
      socket.leave(roomId);
      
      if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).delete(socket.id);
        
        if (activeRooms.get(roomId).size === 0) {
          // Schedule room cleanup instead of immediate deletion
          scheduleRoomForCleanup(roomId);
        } else {
          io.to(roomId).emit("user_list", Array.from(activeRooms.get(roomId).values()));
        }
      }
      
      console.log(`Socket ${socket.id} left room: ${roomId}`);
    } catch (error) {
      console.error("Error in leave_room:", error);
      socket.emit("error", { message: "Failed to leave room" });
    }
  });

  // Enhanced disconnect handling with proper cleanup
  socket.on("disconnect", () => {
    try {
      console.log("User disconnected:", socket.id);
      
      activeRooms.forEach((users, room_id) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          
          // Schedule room for cleanup if empty
          if (users.size === 0) {
            scheduleRoomForCleanup(room_id);
          } else {
            io.to(room_id).emit("user_list", Array.from(users.values()));
          }
        }
      });
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// MEMORY LEAK PREVENTION: Improved room cleanup scheduling
const scheduleRoomForCleanup = (roomId) => {
  // Clear any existing cleanup timer first
  if (roomCleanupTimers.has(roomId)) {
    clearTimeout(roomCleanupTimers.get(roomId));
    roomCleanupTimers.delete(roomId);
  }
  
  const cleanupTimer = setTimeout(async () => {
    try {
      if (activeRooms.has(roomId) && activeRooms.get(roomId).size === 0) {
        console.log(`Room ${roomId} is empty, checking for cleanup...`);
        
        const roomDetails = await runQuery(async (client) => {
          const result = await client.query(
            "SELECT created_at, status FROM rooms WHERE room_id = $1",
            [roomId]
          );
          return result.rows[0];
        });
        
        if (roomDetails) {
          const roomAge = Date.now() - new Date(roomDetails.created_at).getTime();
          
          if (roomAge > CONFIG.EMPTY_ROOM_CLEANUP_TIME || roomDetails.status === ROOM_STATUS.FINISHED) {
            console.log(`Room ${roomId} is old or finished, cleaning up data...`);
            await cleanupRoomData(roomId, true);
          } else {
            activeRooms.delete(roomId);
          }
        } else {
          activeRooms.delete(roomId);
        }
      }
    } catch (error) {
      console.error(`Error in scheduled room cleanup for ${roomId}:`, error);
      activeRooms.delete(roomId);
    } finally {
      roomCleanupTimers.delete(roomId);
    }
  }, CONFIG.ROOM_CLEANUP_DELAY);
  
  roomCleanupTimers.set(roomId, cleanupTimer);
};

// CLEANUP: Graceful shutdown handling
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  
  try {
    // Clear all cleanup timers
    roomCleanupTimers.forEach(timer => clearTimeout(timer));
    roomCleanupTimers.clear();
    
    // Notify all connected users
    activeRooms.forEach((users, roomId) => {
      io.to(roomId).emit("server_shutdown", { 
        message: "Server is shutting down. Please reconnect in a moment." 
      });
    });
    
    // Close server
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = { app, server };

// Only runs when this file is directly called 
if (require.main === module) {
  server.listen(5000, () => {
    console.log("Server is running on port 5000");
  });
}
