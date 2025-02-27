require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const cors = require("cors");
const pg = require("pg");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.connect((err) => {
  if (err) console.error("Database connection failed:", err.stack);
  else console.log("Connected to PostgreSQL database");
});

app.use(cors());
app.use(express.json());

//Logging middleware to help provide better responses when there are issues 
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

//used to temperarly store perdictions 
const TEMP_TABLE = "refinement_predictions";
//using gmail for sending the action items 
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.APP_EMAIL,
    pass: process.env.APP_PASS,
  },
});

//Generates a unique invite code
const generateUniqueInviteCode = async () => {
  let inviteCode, check;
  do {
    inviteCode = crypto.randomBytes(3).toString("hex");
    check = await pool.query("SELECT 1 FROM refinement_rooms WHERE invite_code = $1", [inviteCode]);
  } while (check.rowCount > 0);
  return inviteCode;
};

// ========================= Room Management =========================
// Create Refinement Room
app.post("/refinement/create/room", async (req, res) => {
  try {
    const invite_code = await generateUniqueInviteCode();
    const room_id = uuidv4();
    const result = await pool.query(
      "INSERT INTO refinement_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING room_id, invite_code",
      [room_id, invite_code]
    );
    res.json({ success: true, message: "Refinement Room created successfully", room_id: result.rows[0].room_id, invite_code: result.rows[0].invite_code });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ success: false, message: "Failed to create room." });
  }
});

// Join Refinement Room
app.post("/refinement/join/room", async (req, res) => {
  try {
    const { name, email, invite_code } = req.body;
    const result = await pool.query("SELECT room_id FROM refinement_rooms WHERE invite_code = $1", [invite_code]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Invalid invite code." });

    const room_id = result.rows[0].room_id;
    await pool.query(
      "INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [room_id, name, email]
    );
    res.json({ success: true, message: "Joined refinement room successfully", room_id });
  } catch (error) {
    console.error("Error joining room:", error);
    res.status(500).json({ success: false, message: "Failed to join room." });
  }
});

// Create Retro Room
app.post("/retro/create/room", async (req, res) => {
  try {
    const invite_code = await generateUniqueInviteCode();
    const room_id = uuidv4();
    const result = await pool.query(
      "INSERT INTO retro_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING room_id, invite_code",
      [room_id, invite_code]
    );
    res.json({ success: true, message: "Retro Room created successfully", room_id: result.rows[0].room_id, invite_code: result.rows[0].invite_code });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ success: false, message: "Failed to create room." });
  }
});

// Join Retro Room
app.post("/retro/join/room", async (req, res) => {
  try {
    const { name, email, invite_code } = req.body;
    const result = await pool.query("SELECT room_id FROM retro_rooms WHERE invite_code = $1", [invite_code]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Invalid invite code." });

    const room_id = result.rows[0].room_id;
    await pool.query(
      "INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [room_id, name, email]
    );
    res.json({ success: true, message: "Joined retro room successfully", room_id });
  } catch (error) {
    console.error("Error joining room:", error);
    res.status(500).json({ success: false, message: "Failed to join room." });
  }
});

// ========================= Predictions Handling =========================
// Submit Prediction
app.post("/refinement/prediction/submit", async (req, res) => {
  const { room_id, role, prediction } = req.body;
  if (!role || isNaN(prediction) || prediction <= 0) {
    return res.status(400).json({ success: false, message: "Invalid prediction data" });
  }

  try {
    await pool.query(
      `INSERT INTO ${TEMP_TABLE} (room_id, role, prediction, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (room_id, role) DO UPDATE SET prediction = EXCLUDED.prediction`,
      [room_id, role, prediction]
    );

    res.json({ success: true, message: "Prediction submitted successfully" });
  } catch (error) {
    console.error("Error submitting prediction:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

//Retrieve Predictions
app.get("/refinement/get/predictions", async (req, res) => {
  const { room_id } = req.query;
  if (!room_id) return res.status(400).json({ success: false, message: "Missing room_id" });

  try {
    const result = await pool.query(
      `SELECT role, AVG(prediction) AS final_prediction FROM ${TEMP_TABLE} WHERE room_id = $1 GROUP BY role ORDER BY role`,
      [room_id]
    );

    const predictions = result.rows.map((row) => ({
      role: row.role,
      final_prediction: parseFloat(row.final_prediction),
    }));

    await pool.query(`DELETE FROM ${TEMP_TABLE} WHERE room_id = $1`, [room_id]);
    res.json({ success: true, predictions });
  } catch (error) {
    console.error("Error retrieving predictions:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ========================= Retro Comments =========================
// Add Retro Comment
app.post("/retro/new/comment", async (req, res) => {
  const { room_id, comment } = req.body;
  io.to(room_id).emit("new_comment", comment);
  res.json({ success: true, message: "Comment added successfully" });
});

// Create Action Item
app.post("/retro/create/action", async (req, res) => {
  const { room_id, user_name, description } = req.body;

  const userResult = await pool.query(
    "SELECT email FROM room_users WHERE room_id = $1 AND name = $2",
    [room_id, user_name]
  );

  if (userResult.rowCount === 0)
    return res.status(400).json({ error: "User not found in the room" });

  const email = userResult.rows[0].email;
  await pool.query(
    "INSERT INTO retro_actions (room_id, user_name, description) VALUES ($1, $2, $3)",
    [room_id, user_name, description]
  );

  const mailOptions = {
    from: process.env.APP_EMAIL,
    to: email,
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

  res.json({ message: "Action created and email sent successfully" });
});

// ========================= WebSocket Events =========================
// In-memory tracking of active sockets per room
const activeRooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join_room", async (data) => {
    const { invite_code, name, email } = data;
    try {
      const result = await pool.query(
        "SELECT room_id FROM refinement_rooms WHERE invite_code = $1 UNION SELECT room_id FROM retro_rooms WHERE invite_code = $1",
        [invite_code]
      );
      if (result.rowCount === 0) {
        socket.emit("error", { message: "Room not found" });
      } else {
        const room_id = result.rows[0].room_id;
        socket.join(room_id);
        console.log(`User ${socket.id} joined room: ${room_id} (${name})`);
  
        // Track active users with details
        if (!activeRooms.has(room_id)) activeRooms.set(room_id, new Map());
        activeRooms.get(room_id).set(socket.id, { name, email });
  
        // Emit updated user list with names & emails
        io.to(room_id).emit(
          "user_list",
          Array.from(activeRooms.get(room_id).values())
        );
      }
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("error", { message: "Internal server error" });
    }
  });
  

  socket.on("submit_prediction", (data) => {
    const { room_id, role, prediction } = data;
    io.to(room_id).emit("prediction_submitted", { role, prediction });
  });  

  socket.on("create_room", (roomData) => {
    io.emit("A new room has been created", roomData);
  });

  socket.on("create_action", (actionData) => {
    io.to(actionData.room_id).emit("action_created", actionData);
  });

  // On disconnect, remove the socket from any room's active list and broadcast updated list
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    activeRooms.forEach((users, room_id) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        io.to(room_id).emit("user_list", Array.from(users.values())); // Send updated list
      }
    });
  });
  
});

server.listen(5000, () => {
  console.log("Server is running on port 5000");
});