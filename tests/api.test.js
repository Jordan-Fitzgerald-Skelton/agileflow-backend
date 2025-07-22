const request = require("supertest");
const { app, server } = require("../server");
const { pool } = require("../utils/db");

// Mock the email notification function
jest.mock("../utils/email", () => ({
  sendActionNotification: jest.fn().mockResolvedValue(true)
}));

describe("Endpoint tests", () => {
  let refinementInviteCode = "";
  let retroInviteCode = "";
  let refinementRoomId = "";
  let retroRoomId = "";
  let commentId = "";

  // Close the database connection and server after all tests
  afterAll(async () => {
    await pool.end();
    server.close();
  });

  // Room creation tests
  describe("Room Creation", () => {
    test("create a refinement room successfully", async () => {
      const res = await request(app).post("/create/room").send({
        room_type: "refinement"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invite_code).toBeDefined();
      expect(res.body.room_id).toBeDefined();
      refinementInviteCode = res.body.invite_code;
      refinementRoomId = res.body.room_id;
    });

    test("create a retro room successfully", async () => {
      const res = await request(app).post("/create/room").send({
        room_type: "retro"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invite_code).toBeDefined();
      expect(res.body.room_id).toBeDefined();
      retroInviteCode = res.body.invite_code;
      retroRoomId = res.body.room_id;
    });

    test("fail to create room with invalid room type", async () => {
      const res = await request(app).post("/create/room").send({
        room_type: "invalid_type"
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("fail to create room with missing room type", async () => {
      const res = await request(app).post("/create/room").send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Room joining tests
  describe("Room Joining", () => {
    test("join a refinement room successfully", async () => {
      const res = await request(app).post("/join/room").send({
        invite_code: refinementInviteCode,
        name: "Bob",
        email: "bob@example.com"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.room_id).toBe(refinementRoomId);
      expect(res.body.room_type).toBe("refinement");
    });

    test("join a retro room successfully", async () => {
      const res = await request(app).post("/join/room").send({
        invite_code: retroInviteCode,
        name: "Alice",
        email: "alice@example.com"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.room_id).toBe(retroRoomId);
      expect(res.body.room_type).toBe("retro");
    });

    test("fail to join room with invalid invite code", async () => {
      const res = await request(app).post("/join/room").send({
        invite_code: "invalid_code",
        name: "Charlie",
        email: "charlie@example.com"
      });
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("fail to join room with missing fields", async () => {
      const res = await request(app).post("/join/room").send({
        invite_code: refinementInviteCode,
        name: "Dave"
        // Missing email
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("fail to join room with invalid email format", async () => {
      const res = await request(app).post("/join/room").send({
        invite_code: refinementInviteCode,
        name: "Eve",
        email: "not_an_email"
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Refinement prediction tests
  describe("Refinement Predictions", () => {
    test("submit a prediction successfully", async () => {
      const res = await request(app).post("/refinement/prediction/submit").send({
        room_id: refinementRoomId,
        name: "Bob",
        role: "Dev",
        prediction: 5
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("submit another prediction for a different role", async () => {
      const res = await request(app).post("/refinement/prediction/submit").send({
        room_id: refinementRoomId,
        name: "Bob",
        role: "QA",
        prediction: 8
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("fail to submit a prediction with invalid data", async () => {
      const res = await request(app).post("/refinement/prediction/submit").send({
        room_id: refinementRoomId,
        name: "Bob",
        role: "Dev",
        prediction: "not_a_number"
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("fail to submit a prediction with negative value", async () => {
      const res = await request(app).post("/refinement/prediction/submit").send({
        room_id: refinementRoomId,
        name: "Bob",
        role: "Dev",
        prediction: -1
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("fail to submit a prediction with missing fields", async () => {
      const res = await request(app).post("/refinement/prediction/submit").send({
        room_id: refinementRoomId,
        name: "Bob"
        // Missing role and prediction
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("get predictions successfully", async () => {
      const res = await request(app).get("/refinement/get/predictions").query({
        room_id: refinementRoomId
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.predictions)).toBe(true);
      // Since we added predictions for two roles, check that both exist
      expect(res.body.predictions.length).toBeGreaterThanOrEqual(1);
    });

    test("fail to get predictions with missing room_id", async () => {
      const res = await request(app).get("/refinement/get/predictions");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Retro comment tests
  describe("Retro Comments", () => {
    test("add a comment successfully", async () => {
      const res = await request(app).post("/retro/new/comment").send({
        room_id: retroRoomId,
        comment: "Great job team!",
        user_name: "Alice",
        email: "alice@example.com"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.comment_id).toBeDefined();
      commentId = res.body.comment_id;
    });

    test("fail to add a comment with missing required fields", async () => {
      const res = await request(app).post("/retro/new/comment").send({
        room_id: retroRoomId,
        // Missing comment or user_name
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("get comments successfully", async () => {
      const res = await request(app).get("/retro/get/comments").query({
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.comments)).toBe(true);
      expect(res.body.comments.length).toBeGreaterThanOrEqual(1);
    });

    test("fail to get comments with missing room_id", async () => {
      const res = await request(app).get("/retro/get/comments");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("update a comment successfully", async () => {
      const res = await request(app).put("/retro/update/comment").send({
        comment_id: commentId,
        comment: "Updated comment text",
        user_name: "Alice",
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.comment.comment).toBe("Updated comment text");
    });

    test("fail to update a comment with unauthorized user", async () => {
      const res = await request(app).put("/retro/update/comment").send({
        comment_id: commentId,
        comment: "This update should fail",
        user_name: "Unauthorized User", // Different from Alice who created it
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test("fail to update a comment with missing fields", async () => {
      const res = await request(app).put("/retro/update/comment").send({
        comment_id: commentId,
        // Missing comment, user_name, or room_id
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("delete a comment successfully", async () => {
      const res = await request(app).delete("/retro/delete/comment").send({
        comment_id: commentId,
        user_name: "Alice",
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("fail to delete a comment with unauthorized user", async () => {
      // First create a new comment
      const createRes = await request(app).post("/retro/new/comment").send({
        room_id: retroRoomId,
        comment: "Another comment",
        user_name: "Alice",
        email: "alice@example.com"
      });
      const newCommentId = createRes.body.comment_id;

      // Try to delete with wrong user
      const res = await request(app).delete("/retro/delete/comment").send({
        comment_id: newCommentId,
        user_name: "Unauthorized User",
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test("fail to delete a comment with missing fields", async () => {
      const res = await request(app).delete("/retro/delete/comment").send({
        comment_id: commentId,
        // Missing user_name or room_id
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Retro action tests
  describe("Retro Actions", () => {
    test("create an action item successfully", async () => {
      const res = await request(app).post("/retro/create/action").send({
        room_id: retroRoomId,
        user_name: "Alice",
        description: "Follow up on last sprint bugs",
        assignee_name: "Alice"
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.action_id).toBeDefined();
    });

    test("fail to create an action item with missing fields", async () => {
      const res = await request(app).post("/retro/create/action").send({
        room_id: retroRoomId,
        user_name: "Alice"
        // Missing description
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("fail to create an action item with non-existent assignee", async () => {
      const res = await request(app).post("/retro/create/action").send({
        room_id: retroRoomId,
        user_name: "Alice",
        description: "This should fail",
        assignee_name: "NonExistentUser"
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Room finishing tests
  describe("Room Finishing", () => {
    test("finish a room successfully", async () => {
      const res = await request(app).post("/finish/room").send({
        room_id: retroRoomId
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("fail to finish a room with missing room_id", async () => {
      const res = await request(app).post("/finish/room").send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});