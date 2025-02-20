require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const pg = require("pg");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

app.use(cors());
app.use(express.json());

const TEMP_TABLE = "refinement_predictions";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.APP_EMAIL,
    pass: process.env.APP_PASS,
  },
});

// ========================= Room Management =========================
app.post("/api/refinement/rooms", async (req, res) => {
  const { room_id, invite_code } = req.body;
  await pool.query("INSERT INTO rooms (room_id, invite_code) VALUES ($1, $2)", [room_id, invite_code]);
  res.json({ message: "Refinement Room created successfully" });
});

app.post("/api/rooms", async (req, res) => {
  const { room_id, invite_code } = req.body;
  await pool.query("INSERT INTO rooms (room_id, invite_code) VALUES ($1, $2)", [room_id, invite_code]);
  res.json({ message: "Room created successfully" });
});

app.post("/api/refinement/rooms/join", async (req, res) => {
  const { name, email, invite_code } = req.body;
  const roomCheck = await pool.query("SELECT room_id FROM rooms WHERE invite_code = $1", [invite_code]);
  if (roomCheck.rowCount === 0) {
    return res.status(400).json({ error: "Invalid invite code" });
  }
  const room_id = roomCheck.rows[0].room_id;
  await pool.query("INSERT INTO room_users (room_id, name, email) VALUES ($1, $2, $3)", [room_id, name, email]);
  res.json({ message: "Joined refinement room successfully" });
});

// ========================= Predictions Handling =========================
app.post("/api/refinement/predict", async (req, res) => {
  const { room_id, role, name, prediction } = req.body;
  if (!role || isNaN(prediction) || prediction <= 0) {
    return res.status(400).json({ error: "Invalid prediction data" });
  }
  await pool.query(
    `INSERT INTO ${TEMP_TABLE} (room_id, role, name, prediction)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (room_id, name) DO UPDATE SET prediction = EXCLUDED.prediction`,
    [room_id, role, name, prediction]
  );
  res.json({ message: "Prediction submitted successfully" });
});

// ========================= Retrospective Comments =========================
app.post("/api/retro/comments", async (req, res) => {
  const { room_id, comment } = req.body;
  await pool.query("INSERT INTO retro_comments (room_id, comment) VALUES ($1, $2)", [room_id, comment]);
  const results = await pool.query("SELECT comment FROM retro_comments WHERE room_id = $1", [room_id]);
  io.to(room_id).emit("comment_added", results.rows);
  res.json({ message: "Comment added successfully" });
});

// ========================= Action Items =========================
app.post("/api/retro/actions", async (req, res) => {
  const { room_id, user_name, description } = req.body;
  const userResult = await pool.query("SELECT email FROM room_users WHERE room_id = $1 AND name = $2", [room_id, user_name]);
  if (userResult.rowCount === 0) {
    return res.status(400).json({ error: "User not found in the room" });
  }
  const email = userResult.rows[0].email;
  await pool.query("INSERT INTO retro_actions (room_id, user_name, description) VALUES ($1, $2, $3)", [room_id, user_name, description]);
  
  const mailOptions = {
    from: "your_email@gmail.com",
    to: email,
    subject: "New Action Item Assigned",
    text: `Hello ${user_name},\n\nYou have been assigned a new action item:\n\n${description}\n\nBest Regards,\nAgileFlow Team`,
  };
  transporter.sendMail(mailOptions, () => {});
  io.to(room_id).emit("action_added", { user_name, description });
  res.json({ message: "Action created and email sent successfully" });
});

// ========================= WebSocket Events =========================
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("join_room", (room_id) => {
    socket.join(room_id);
    console.log(`User joined room: ${room_id}`);
  });

  socket.on("submit_prediction", async (data) => {
    const { room_id, role, name, prediction } = data;
    if (!role || isNaN(prediction) || prediction <= 0) return;
    await pool.query(
      `INSERT INTO ${TEMP_TABLE} (room_id, role, name, prediction)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, name) DO UPDATE SET prediction = EXCLUDED.prediction`,
      [room_id, role, name, prediction]
    );
    const results = await pool.query(`SELECT role, prediction FROM ${TEMP_TABLE} WHERE room_id = $1`, [room_id]);
    io.to(room_id).emit("prediction_submitted", results.rows);
  });

  socket.on("add_comment", async (data) => {
    const { room_id, comment } = data;
    await pool.query("INSERT INTO retro_comments (room_id, comment) VALUES ($1, $2)", [room_id, comment]);
    const results = await pool.query("SELECT comment FROM retro_comments WHERE room_id = $1", [room_id]);
    io.to(room_id).emit("comment_added", results.rows);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

server.listen(5000, () => {
  console.log("Server is running on port 5000");
});
