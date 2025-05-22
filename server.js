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
const { sendActionNotification } = require("./utils/email");

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

//temporary table
const TEMP_TABLE = "refinement_predictions";

//generate a invite code (6 random characters)
const inviteCode = async () => {
  let inviteCode, check;
  //makes sure its unique 
  do {
    inviteCode = crypto.randomBytes(3).toString("hex");
    check = await pool.query("SELECT 1 FROM rooms WHERE invite_code = $1", [inviteCode]);
  } while (check.rowCount > 0);
  return inviteCode;
};

//cleans up the room data when a room is finished
const cleanupRoomData = async (room_id) => {
  try {
    await runQuery(async (client) => {
      //delete all the data for the room
      await client.query(`DELETE FROM ${TEMP_TABLE} WHERE room_id = $1`, [room_id]);
      await client.query("DELETE FROM retro_comments WHERE room_id = $1", [room_id]);
      await client.query("DELETE FROM retro_actions WHERE room_id = $1", [room_id]);
      await client.query("DELETE FROM room_users WHERE room_id = $1", [room_id]);
      await client.query("DELETE FROM rooms WHERE room_id = $1", [room_id]);

      console.log(`[${new Date().toISOString()}] Cleaned up data for room: ${room_id}`);
    });
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error cleaning up room data:`, error);
    return false;
  }
};

//create a room
app.post("/create/room", async (req, res) => {
  try {
    const { room_type } = req.body;
    //validate the room_type
    if (!room_type || !['refinement', 'retro'].includes(room_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid room type. Must be 'refinement' or 'retro'."
      });
    }
    const result = await runQuery(async (client) => {
      const invite_code = await inviteCode();
      const room_id = uuidv4();
      const result = await client.query(
        "INSERT INTO rooms (room_id, invite_code, room_type, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING room_id, invite_code",
        [room_id, invite_code, room_type]
      );
      return result;
    });
    res.json({
      success: true,
      message: `${room_type.charAt(0).toUpperCase() + room_type.slice(1)} Room created successfully`,
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
    //basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }
    const result = await runQuery(async (client) => {
      const roomResult = await client.query(
        "SELECT room_id, room_type FROM rooms WHERE invite_code = $1",
        [invite_code]
      );
      if (roomResult.rowCount === 0) {
        throw new Error("Invalid invite code");
      }
      const { room_id, room_type } = roomResult.rows[0];
      //Check if the user can be added to the room, if they already are do nothing
      await client.query(
        "INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [room_id, name, email]
      );

      return { room_id, room_type };
    });
    res.json({
      success: true,
      message: `Joined ${result.room_type} room successfully`,
      room_id: result.room_id,
      room_type: result.room_type
    });
  } catch (error) {
    if (error.message === "Invalid invite code") {
      return res.status(404).json({
        success: false,
        message: "Invalid invite code."
      });
    }
    return handleError(res, error, "Failed to join room");
  }
});

app.post("/finish/room", async (req, res) => {
  try {
    const { room_id } = req.body;
    if (!room_id) {
      return res.status(400).json({
        success: false,
        message: "Room ID is required"
      });
    }
    const cleaned = await cleanupRoomData(room_id);
    if (cleaned) {
      //tells all connected users the room is closed
      io.to(room_id).emit("room_closed", { message: "This room has been closed by the host" });
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

//refinement endpoints
app.post("/refinement/prediction/submit", async (req, res) => {
  const { room_id, name, role, prediction } = req.body;
  // Input validation
  if (!room_id || !name || !role || isNaN(prediction) || prediction <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid prediction data"
    });
  }
  try {
    await runQuery(async (client) => {
      //adds the prediction
      await client.query(
        `INSERT INTO ${TEMP_TABLE} (room_id, name, role, prediction, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (room_id, name, role) DO UPDATE SET prediction = EXCLUDED.prediction`,
        [room_id, name, role, prediction]
      );
    });

    //updates the submission status for the user in activeRooms
    if (activeRooms.has(room_id)) {
      const socketIds = [];
      //find socket ids for the submitting user
      activeRooms.get(room_id).forEach((userData, socketId) => {
        if (userData.name === name) {
          userData.hasSubmitted = true;
          socketIds.push(socketId);
        }
      });
      //sends the updated user list to everyone in the room
      io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
    }
    res.json({
      success: true,
      message: "Prediction submitted successfully"
    });
  } catch (error) {
    return handleError(res, error, "Failed to submit prediction");
  }
});

app.get("/refinement/get/predictions", async (req, res) => {
  const { room_id } = req.query;
  if (!room_id) {
    return res.status(400).json({
      success: false,
      message: "Missing room_id"
    });
  }
  try {
    const result = await runQuery(async (client) => {
      //gets the average prediction for each role
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
      //clean up
      await client.query(
        `DELETE FROM ${TEMP_TABLE} WHERE room_id = $1`,
        [room_id]
      );
      // Reset submission status for all users in the room
      if (activeRooms.has(room_id)) {
        activeRooms.get(room_id).forEach((userData) => {
          userData.hasSubmitted = false;
        });
        // Emit updated user list
        io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
      }
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

//retro endpoints
app.post("/retro/new/comment", async (req, res) => {
  try {
    const { room_id, comment, user_name, email } = req.body;
    if (!room_id || !comment || !user_name) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    //sanitise the comment
    const sanitizedComment = comment.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const result = await runQuery(async (client) => {
      const commentResult = await client.query(
        "INSERT INTO retro_comments (room_id, comment, user_name, email, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id",
        [room_id, sanitizedComment, user_name, email || null]
      );

      return { comment_id: commentResult.rows[0].id };
    });
    //emit the new comment with the users details
    io.to(room_id).emit("new_comment", {
      id: result.comment_id,
      comment: sanitizedComment,
      user_name: user_name,
      email: email || null,
      created_at: new Date().toISOString()
    });
    res.json({
      success: true,
      message: "Comment added successfully",
      comment_id: result.comment_id
    });
  } catch (error) {
    return handleError(res, error, "Failed to add comment");
  }
});

app.get("/retro/get/comments", async (req, res) => {
  try {
    const { room_id } = req.query;
    if (!room_id) {
      return res.status(400).json({
        success: false,
        message: "Missing room_id"
      });
    }
    const result = await runQuery(async (client) => {
      const commentsResult = await client.query(
        "SELECT id, comment, user_name, email, created_at FROM retro_comments WHERE room_id = $1 ORDER BY created_at ASC",
        [room_id]
      );

      return commentsResult.rows;
    });
    res.json({
      success: true,
      comments: result
    });
  } catch (error) {
    return handleError(res, error, "Failed to retrieve comments");
  }
});

app.put("/retro/update/comment", async (req, res) => {
  try {
    const { comment_id, comment, user_name, room_id } = req.body;
    if (!comment_id || !comment || !user_name || !room_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    //sanitise the updated comment
    const sanitizedComment = comment.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const result = await runQuery(async (client) => {
      //check if the user is the one who created the comment
      const checkResult = await client.query(
        "SELECT 1 FROM retro_comments WHERE id = $1 AND user_name = $2",
        [comment_id, user_name]
      );
      if (checkResult.rowCount === 0) {
        throw new Error("Unauthorized");
      }
      await client.query(
        "UPDATE retro_comments SET comment = $1 WHERE id = $2",
        [sanitizedComment, comment_id]
      );
      //get the updated comment
      const updatedResult = await client.query(
        "SELECT id, comment, user_name, email, created_at FROM retro_comments WHERE id = $1",
        [comment_id]
      );
      return updatedResult.rows[0];
    });
    //emit the updated comment
    io.to(room_id).emit("comment_updated", result);

    res.json({
      success: true,
      message: "Comment updated successfully",
      comment: result
    });
  } catch (error) {
    if (error.message === "Unauthorized") {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this comment"
      });
    }
    return handleError(res, error, "Failed to update comment");
  }
});

app.delete("/retro/delete/comment", async (req, res) => {
  try {
    const { comment_id, user_name, room_id } = req.body;
    if (!comment_id || !user_name || !room_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    await runQuery(async (client) => {
      //check if the user is the one who created the comment
      const checkResult = await client.query(
        "SELECT 1 FROM retro_comments WHERE id = $1 AND user_name = $2",
        [comment_id, user_name]
      );
      if (checkResult.rowCount === 0) {
        throw new Error("Unauthorized");
      }
      await client.query(
        "DELETE FROM retro_comments WHERE id = $1",
        [comment_id]
      );
    });
    //emit that the comment was deleted
    io.to(room_id).emit("comment_deleted", { comment_id });
    res.json({
      success: true,
      message: "Comment deleted successfully"
    });
  } catch (error) {
    if (error.message === "Unauthorized") {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this comment"
      });
    }
    return handleError(res, error, "Failed to delete comment");
  }
});

app.post("/retro/create/action", async (req, res) => {
  try {
    const { room_id, user_name, description, assignee_name } = req.body;
    const assignedTo = assignee_name || user_name;
    if (!room_id || !user_name || !description) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }
    const result = await runQuery(async (client) => {
      const userResult = await client.query(
        "SELECT email FROM room_users WHERE room_id = $1 AND name = $2",
        [room_id, assignedTo]
      );
      if (userResult.rowCount === 0) {
        throw new Error("Assigned user not found in the room");
      }
      const email = userResult.rows[0].email;
      const actionResult = await client.query(
        "INSERT INTO retro_actions (room_id, user_name, description) VALUES ($1, $2, $3) RETURNING id",
        [room_id, assignedTo, description]
      );
      return { email, action_id: actionResult.rows[0].id };
    });

    //send the email
    await sendActionNotification({
      email: result.email,
      userName: assignedTo,
      description: description
    });
    io.to(room_id).emit("action_added", {
      id: result.action_id,
      user_name: assignedTo,
      description
    });
    res.json({
      success: true,
      message: "Action created and email sent successfully",
      action_id: result.action_id
    });
  } catch (error) {
    if (error.message === "Assigned user not found in the room") {
      return res.status(400).json({
        success: false,
        message: "Assigned user not found in the room"
      });
    }
    return handleError(res, error, "Failed to create action item");
  }
});

//websockets

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
      //check the invite code
      const result = await pool.query(
        "SELECT room_id, room_type FROM rooms WHERE invite_code = $1",
        [invite_code]
      );
      if (result.rowCount === 0) {
        socket.emit("error", { message: "Room not found" });
        return;
      }
      const room_id = result.rows[0].room_id;
      const room_type = result.rows[0].room_type;
      socket.join(room_id);
      console.log(`User ${socket.id} joined room: ${room_id} (${name})`);
      //track the active users
      if (!activeRooms.has(room_id)) {
        activeRooms.set(room_id, new Map());
      }
      const userData = {
        name,
        email,
        hasSubmitted: false
      };
      activeRooms.get(room_id).set(socket.id, userData);
      //update the active user list
      io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
      //if this is a retro room, send existing comments
      if (room_type === 'retro') {
        try {
          const commentsResult = await pool.query(
            "SELECT id, comment, user_name, email, created_at FROM retro_comments WHERE room_id = $1 ORDER BY created_at ASC",
            [room_id]
          );
          socket.emit("initial_comments", commentsResult.rows);
        } catch (error) {
          console.error("Error fetching initial comments:", error);
        }
      }
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

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

  socket.on("submit_prediction", async (data) => {
    try {
      const { room_id, name, role, prediction } = data;
      if (!room_id || !name || !role || isNaN(prediction) || prediction <= 0) {
        socket.emit("error", { message: "Invalid prediction data" });
        return;
      }
      await runQuery(async (client) => {
        await client.query(
          `INSERT INTO ${TEMP_TABLE} (room_id, name, role, prediction, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (room_id, name, role) DO UPDATE SET prediction = EXCLUDED.prediction`,
          [room_id, name, role, prediction]
        );
      });
      if (activeRooms.has(room_id)) {
        const userData = activeRooms.get(room_id).get(socket.id);
        if (userData?.name === name) {
          userData.hasSubmitted = true;
          //update all connected users with new user list
          io.to(room_id).emit("user_list", Array.from(activeRooms.get(room_id).values()));
        }
      }
      io.to(room_id).emit("prediction_submitted", { name, role, prediction });
      console.log(`Prediction submitted for room ${room_id}: ${name} (${role}) = ${prediction}`);
    } catch (error) {
      console.error("Error in submit_prediction:", error);
      socket.emit("error", { message: "Failed to submit prediction" });
    }
  });

  socket.on("reset_session", async (data) => {
    try {
      const { room_id } = data;
      if (!room_id) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }
      //check if room exists in database
      const roomExists = await runQuery(async (client) => {
        const result = await client.query(
          "SELECT 1 FROM rooms WHERE room_id = $1",
          [room_id]
        );
        return result.rowCount > 0;
      });
      if (!roomExists) {
        socket.emit("error", { message: "Room not found" });
        return;
      }
      //reset the hasSubmitted status for all users in the room
      if (activeRooms.has(room_id)) {
        activeRooms.get(room_id).forEach(userData => {
          userData.hasSubmitted = false;
        });
        //clear any stored predictions in the database
        await runQuery(async (client) => {
          await client.query(
            `DELETE FROM ${TEMP_TABLE} WHERE room_id = $1`,
            [room_id]
          );
        });

        //emit the updated user list with reset submission status
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
      //check if room exists in the database
      const roomExists = await runQuery(async (client) => {
        const result = await client.query(
          "SELECT 1 FROM rooms WHERE room_id = $1",
          [room_id]
        );
        return result.rowCount > 0;
      });

      if (!roomExists) {
        socket.emit("error", { message: "Room not found" });
        return;
      }
      //validate the predictions format
      if (!Array.isArray(predictions)) {
        socket.emit("error", { message: "Predictions must be an array" });
        return;
      }

      //check if predictions have the expected structure
      const isValidPrediction = predictions.every(pred =>
        typeof pred === 'object' &&
        pred !== null &&
        'role' in pred &&
        'final_prediction' in pred &&
        typeof pred.role === 'string' &&
        typeof pred.final_prediction === 'number'
      );
      if (!isValidPrediction) {
        socket.emit("error", {
          message: "Predictions must have role (string) and final_prediction (number) properties"
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
      //removes the user from the active user list and the room when it's empty
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

  //when disconnecting, the room is remove the socket and the rooms list then the updated list is returned 
  socket.on("disconnect", () => {
    try {
      console.log("User disconnected:", socket.id);
      activeRooms.forEach((users, room_id) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          //this will remove the room when its empty after 30 seconds
          if (users.size === 0) {
            setTimeout(async () => {
              //check if the room is still empty after timeout
              if (activeRooms.has(room_id) && activeRooms.get(room_id).size === 0) {
                //instead of just removing from activeRooms, also clean up database
                try {
                  //get room details to determine if it should be cleaned up
                  const roomDetails = await runQuery(async (client) => {
                    const result = await client.query(
                      "SELECT created_at FROM rooms WHERE room_id = $1",
                      [room_id]
                    );
                    return result.rows[0];
                  });

                  if (roomDetails) {
                    //if the room is older than 2 hours and empty, clean it up
                    const roomAge = Date.now() - new Date(roomDetails.created_at).getTime();
                    const twoHoursInMs = 2 * 60 * 60 * 1000;
                    if (roomAge > twoHoursInMs) {
                      console.log(`Room ${room_id} is empty and older than 2 hours, cleaning up data...`);
                      await cleanupRoomData(room_id);
                    } else {
                      //remove from active rooms but keep in database
                      activeRooms.delete(room_id);
                    }
                  } else {
                    //rooms not found in the database, remove from the active rooms list
                    activeRooms.delete(room_id);
                  }
                } catch (error) {
                  console.error(`Error checking room age for cleanup: ${error}`);
                  //remove from active rooms if it has an error
                  activeRooms.delete(room_id);
                }
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

module.exports = { app, server };

//only runs when this file is directly called 
if (require.main === module) {
  server.listen(5000, () => {
    console.log("Server is running on port 5000");
  });
}
