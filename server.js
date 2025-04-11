require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const cors = require("cors");
const pg = require("pg");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

//imports for the utility files (used for testing)
const { pool, executeTransaction, connectWithRetry } = require('./utils/db');
const { sendActionNotification } = require('./utils/email');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: process.env.FRONT_APP,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  } 
});

//middleware to add rate limitting
const apiLimiter = rateLimit({
  //set a time for 15 minutes
  windowMs: 15 * 60 * 1000,
  //this will limit each IP address to 100 requests every 15 minutes.
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." }
});

//add the rate limiting to all the routes
app.use(apiLimiter);

//method for handeling errors within the server
const handleError = (res, error, message = "An error occurred") => {
  console.error(`[${new Date().toISOString()}] Error:`, error);
  return res.status(500).json({ 
    success: false, 
    message: message
  });
};

connectWithRetry();
app.use(cors());
app.use(express.json());

//middleware to help with logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

//temporary table
const TEMP_TABLE = "refinement_predictions";

//email setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.APP_EMAIL,
    pass: process.env.APP_PASS,
  },
});

//generatea a unique invite code
const generateUniqueInviteCode = async () => {
  let inviteCode, check;
  do {
    inviteCode = crypto.randomBytes(3).toString("hex");
    check = await pool.query("SELECT 1 FROM refinement_rooms WHERE invite_code = $1", [inviteCode]);
  } while (check.rowCount > 0);
  return inviteCode;
};

// ========================= Room Management =========================
//create a refinement room
app.post("/refinement/create/room", async (req, res) => {
  try {
    const result = await executeTransaction(async (client) => {
      const invite_code = await generateUniqueInviteCode();
      const room_id = uuidv4(); 
      const result = await client.query(
        "INSERT INTO refinement_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING room_id, invite_code",
        [room_id, invite_code]
      );
      return result;
    });  
    res.json({ 
      success: true, 
      message: "Refinement Room created successfully", 
      room_id: result.rows[0].room_id, 
      invite_code: result.rows[0].invite_code 
    });
  } catch (error) {
    return handleError(res, error, "Failed to create room");
  }
});

//join a refinement room
app.post("/refinement/join/room", async (req, res) => {
  try {
    const { invite_code, name, email } = req.body;
    if (!invite_code || !name || !email) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields." 
      });
    }
    //input validation
    if (typeof invite_code !== 'string' || typeof name !== 'string' || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid input types"
      });
    }
    //email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }
    const result = await executeTransaction(async (client) => {
      const roomResult = await client.query(
        "SELECT room_id FROM refinement_rooms WHERE invite_code = $1",
        [invite_code]
      );
      if (roomResult.rowCount === 0) {
        throw new Error("Invalid invite code");
      }
      const { room_id } = roomResult.rows[0];
      await client.query(
        "INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [room_id, name, email]
      );
      return { room_id };
    });
    res.json({ 
      success: true, 
      message: "Joined refinement room successfully", 
      room_id: result.room_id 
    });
  } catch (error) {
    if (error.message === "Invalid invite code") {
      return res.status(404).json({ 
        success: false, 
        message: "Invalid invite code." 
      });
    }
    return handleError(res, error, "Failed to join refinement room");
  }
});

//create a retro room
app.post("/retro/create/room", async (req, res) => {
  try {
    const result = await executeTransaction(async (client) => {
      const invite_code = await generateUniqueInviteCode();
      const room_id = uuidv4();
      
      const result = await client.query(
        "INSERT INTO retro_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING room_id, invite_code",
        [room_id, invite_code]
      );
      return result;
    });
    res.json({ 
      success: true, 
      message: "Retro Room created successfully", 
      room_id: result.rows[0].room_id, 
      invite_code: result.rows[0].invite_code 
    });
  } catch (error) {
    return handleError(res, error, "Failed to create room");
  }
});

//join a retro room
app.post("/retro/join/room", async (req, res) => {
  try {
    const { invite_code, name, email } = req.body;
    if (!invite_code || !name || !email) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields." 
      });
    }
    //input validation
    if (typeof invite_code !== 'string' || typeof name !== 'string' || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid input types"
      });
    }
    //email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }
    const result = await executeTransaction(async (client) => {
      const roomResult = await client.query(
        "SELECT room_id FROM retro_rooms WHERE invite_code = $1",
        [invite_code]
      );
      if (roomResult.rowCount === 0) {
        throw new Error("Invalid invite code");
      }
      const { room_id } = roomResult.rows[0];
      await client.query(
        "INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [room_id, name, email]
      );
      return { room_id };
    });
    res.json({ 
      success: true, 
      message: "Joined retro room successfully", 
      room_id: result.room_id 
    });
  } catch (error) {
    if (error.message === "Invalid invite code") {
      return res.status(404).json({ 
        success: false, 
        message: "Invalid invite code." 
      });
    }
    return handleError(res, error, "Failed to join retro room");
  }
});

// ========================= Predictions Handling =========================
//add a prediction
app.post("/refinement/prediction/submit", async (req, res) => {
  const { room_id, role, prediction } = req.body;
  // Input validation
  if (!room_id || !role || isNaN(prediction) || prediction <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid prediction data" 
    });
  }
  try {
    await executeTransaction(async (client) => {
      await client.query(
        `INSERT INTO ${TEMP_TABLE} (room_id, role, prediction, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (room_id, role) DO UPDATE SET prediction = EXCLUDED.prediction`,
        [room_id, role, prediction]
      );
    });
    res.json({ 
      success: true, 
      message: "Prediction submitted successfully" 
    });
  } catch (error) {
    return handleError(res, error, "Failed to submit prediction");
  }
});

//retrieve the predictions
app.get("/refinement/get/predictions", async (req, res) => {
  const { room_id } = req.query;
  if (!room_id) {
    return res.status(400).json({ 
      success: false, 
      message: "Missing room_id" 
    });
  }
  try {
    const result = await executeTransaction(async (client) => {
      const predictionResult = await client.query(
        `SELECT role, AVG(prediction) AS final_prediction 
         FROM ${TEMP_TABLE} 
         WHERE room_id = $1 
         GROUP BY role 
         ORDER BY role`,
        [room_id]
      );
      const predictions = predictionResult.rows.map((row) => ({
        role: row.role,
        final_prediction: parseFloat(row.final_prediction),
      }));
      await client.query(
        `DELETE FROM ${TEMP_TABLE} WHERE room_id = $1`, 
        [room_id]
      );
      return predictions;
    });
    res.json({ 
      success: true, 
      predictions: result
    });
  } catch (error) {
    return handleError(res, error, "Failed to retrieve predictions");
  }
});

// ========================= Retro Comments =========================
//add retro comments
app.post("/retro/new/comment", async (req, res) => {
  try {
    const { room_id, comment } = req.body;
    if (!room_id || !comment) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    //sanitises the comment
    const sanitizedComment = comment.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    //stores the comment in the database
    await executeTransaction(async (client) => {
      await client.query(
        "INSERT INTO retro_comments (room_id, comment, created_at) VALUES ($1, $2, NOW())",
        [room_id, sanitizedComment]
      );
    });

    io.to(room_id).emit("new_comment", sanitizedComment);
    res.json({ 
      success: true, 
      message: "Comment added successfully" 
    });
  } catch (error) {
    return handleError(res, error, "Failed to add comment");
  }
});

//creating action items
app.post("/retro/create/action", async (req, res) => {
  try {
    const { room_id, user_name, description } = req.body;
    if (!room_id || !user_name || !description) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    const result = await executeTransaction(async (client) => {
      const userResult = await client.query(
        "SELECT email FROM room_users WHERE room_id = $1 AND name = $2",
        [room_id, user_name]
      );
      if (userResult.rowCount === 0) {
        throw new Error("User not found in the room");
      }
      const email = userResult.rows[0].email;
      await client.query(
        "INSERT INTO retro_actions (room_id, user_name, description) VALUES ($1, $2, $3)",
        [room_id, user_name, description]
      );
      return { email };
    });
    //send the email
    const mailOptions = {
      from: process.env.APP_EMAIL,
      to: result.email,
      subject: "New Action Item Assigned",
      text: `Hello ${user_name},\n\nYou have been assigned a new action item:\n\n${description}\n\nBest Regards,\nAgileFlow Team`,
    };
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("Error sending email:", err);
      } else {
        console.log("Email sent:", info.response);
      }
    });
    io.to(room_id).emit("action_added", { user_name, description });
    res.json({ 
      success: true,
      message: "Action created and email sent successfully" 
    });
  } catch (error) {
    if (error.message === "User not found in the room") {
      return res.status(400).json({ 
        success: false, 
        message: "User not found in the room" 
      });
    }
    return handleError(res, error, "Failed to create action item");
  }
});

// ========================= WebSocket Events =========================
const activeRooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join_room", async (data) => {
    try {
      const { invite_code, name, email } = data;
      if (!invite_code || !name || !email) {
        socket.emit("error", { message: "Missing required fields" });
        return;
      }
      const result = await pool.query(
        "SELECT room_id FROM refinement_rooms WHERE invite_code = $1 UNION SELECT room_id FROM retro_rooms WHERE invite_code = $1",
        [invite_code]
      );    
      if (result.rowCount === 0) {
        socket.emit("error", { message: "Room not found" });
        return;
      }
      const room_id = result.rows[0].room_id;
      socket.join(room_id);
      console.log(`User ${socket.id} joined room: ${room_id} (${name})`);
      //tracks the "active" users
      if (!activeRooms.has(room_id)) activeRooms.set(room_id, new Map());
      activeRooms.get(room_id).set(socket.id, { name, email });
      //updates the user list
      io.to(room_id).emit(
        "user_list",
        Array.from(activeRooms.get(room_id).values())
      );
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });
  
  socket.on("submit_prediction", (data) => {
    try {
      const { room_id, role, prediction } = data;
      if (!room_id || !role || isNaN(prediction) || prediction <= 0) {
        socket.emit("error", { message: "Invalid prediction data" });
        return;
      }
      io.to(room_id).emit("prediction_submitted", { role, prediction });
    } catch (error) {
      console.error("Error in submit_prediction:", error);
      socket.emit("error", { message: "Failed to submit prediction" });
    }
  });  

  //socket event fro when a room is created
  socket.on("create_room", (roomData) => {
    try {
      if (!roomData || !roomData.room_id) {
        socket.emit("error", { message: "Invalid room data" });
        return;
      }
      socket.to(roomData.room_id).emit("room_created", roomData);
    } catch (error) {
      console.error("Error in create_room:", error);
      socket.emit("error", { message: "Failed to create room" });
    }
  });

  //socket event for action items
  socket.on("create_action", (actionData) => {
    try {
      if (!actionData || !actionData.room_id || !actionData.user_name || !actionData.description) {
        socket.emit("error", { message: "Invalid action data" });
        return;
      }
      io.to(actionData.room_id).emit("action_created", actionData);
    } catch (error) {
      console.error("Error in create_action:", error);
      socket.emit("error", { message: "Failed to create action" });
    }
  });

  //socket event for leaving a room
  socket.on("leave_room", ({ roomId }) => {
    try {
      if (!roomId) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }
      socket.leave(roomId);
      if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).delete(socket.id);
        if (activeRooms.get(roomId).size === 0) {
          activeRooms.delete(roomId);
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

  //When disconnecting, remove the socket from rooms list and send the updated list
  socket.on("disconnect", () => {
    try {
      console.log("User disconnected:", socket.id);
      activeRooms.forEach((users, room_id) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          if (users.size === 0) {
            setTimeout(() => {
              if (activeRooms.has(room_id) && activeRooms.get(room_id).size === 0) {
                activeRooms.delete(room_id);
              }
            }, 30000);
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

//for testing
connectWithRetry();
module.exports = app;

//only runns when this file is directly called 
if (require.main === module) {
  server.listen(5000, () => {
    console.log("Server is running on port 5000");
  });
}