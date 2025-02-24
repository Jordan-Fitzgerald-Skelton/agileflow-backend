require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const cors = require("cors");
const pg = require("pg");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

app.use(cors());
app.use(express.json());

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

// Generate unique invite code securely
const generateUniqueInviteCode = async () => {
  let inviteCode;
  let isUnique = false;
  while (!isUnique) {
    inviteCode = crypto.randomBytes(3).toString('hex');
    const check = await pool.query('SELECT * FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (check.rowCount === 0) isUnique = true;
  }
  return inviteCode;
};

// ========================= Room Management =========================
// Create Refinement Room
app.post("/refinement/create/room", async (req, res) => {
  try{
    const invite_code = await generateUniqueInviteCode();
    const room_id = uuidv4();
    await pool.query(
      "INSERT INTO refinement_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)",
      [room_id, invite_code]
    );
    res.json({ message: "Refinement Room created successfully" });
  }catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room.' });
  }
});

// Join Refinement Room
app.post('/refinement/join/room', async (req, res) => {
  try {
    const { name, email, invite_code } = req.body;
    const result = await pool.query('SELECT room_id FROM refinement_rooms WHERE invite_code = $1', [invite_code]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invalid invite code.' });
    }
    const room_id = result.rows[0].room_id;
    await pool.query(
      "INSERT INTO room_users (room_id, name, email) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM room_users WHERE room_id = $1 AND email = $3)",
      [room_id, name, email]
    );
    res.json({ message: "Joined refinement room successfully" });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, message: 'Failed to join room.' });
  }
});

// Create Retro Room
app.post("/retro/create/room", async (req, res) => {
  try{
    const invite_code = await generateUniqueInviteCode();
    const room_id = uuidv4();
    await pool.query(
      "INSERT INTO retro_rooms (room_id, invite_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)",
      [room_id, invite_code]
    );
    res.json({ message: "Refinement Room created successfully" });
  }catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room.' });
  }
});

// Join Retro Room
app.post('/retro/join/room', async (req, res) => {
  try {
    const { name, email, invite_code } = req.body;
    const result = await pool.query('SELECT room_id FROM retro_rooms WHERE invite_code = $1', [invite_code]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invalid invite code.' });
    }
    const room_id = result.rows[0].room_id;
    await pool.query(
      "INSERT INTO room_users (room_id, name, email) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM room_users WHERE room_id = $1 AND email = $3)",
      [room_id, name, email]
    );
    res.json({ message: "Joined refinement room successfully" });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, message: 'Failed to join room.' });
  }
});

// ========================= Predictions Handling =========================
// Submit Prediction
app.post("/api/refinement/prediction", async (req, res) => {
  const { room_id, role, name, prediction } = req.body;
  if (!role || isNaN(prediction) || prediction <= 0)
    return res.status(400).json({ error: "Invalid prediction data" });

  await pool.query(
    `INSERT INTO ${TEMP_TABLE} (room_id, role, name, prediction)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (room_id, name) DO UPDATE SET prediction = EXCLUDED.prediction`,
    [room_id, role, name, prediction]
  );
  res.json({ message: "Prediction submitted successfully" });
});

// ========================= Retrospective Comments =========================
// Add Retro Comment
app.post("/api/retro/comments", async (req, res) => {
  const { room_id, comment } = req.body;
  await pool.query(
    "INSERT INTO retro_comments (room_id, comment) VALUES ($1, $2)",
    [room_id, comment]
  );

  const results = await pool.query(
    "SELECT comment FROM retro_comments WHERE room_id = $1",
    [room_id]
  );

  io.to(room_id).emit("comment_added", results.rows);
  res.json({ message: "Comment added successfully" });
});

// ========================= Action Items =========================
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

  transporter.sendMail(mailOptions, () => {});
  io.to(room_id).emit("action_added", { user_name, description });

  res.json({ message: "Action created and email sent successfully" });
});

// ========================= WebSocket Events =========================
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("join_room", (invite_code) => {
    pool.query(
      "SELECT room_id FROM rooms WHERE invite_code = $1",
      [invite_code],
      (err, res) => {
        if (err || res.rows.length === 0) {
          socket.emit("error", { message: "Room not found" });
        } else {
          socket.join(res.rows[0].room_id);
          console.log(`User joined room: ${res.rows[0].room_id}`);
        }
      }
    );
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

server.listen(5000, () => {
  console.log("Server is running on port 5000");
});