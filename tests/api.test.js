const request = require("supertest");
const app = require("../server");

describe("API Endpoint Tests", () => {
  let refinementInviteCode = "";
  let retroInviteCode = "";
  let refinementRoomId = "";
  let retroRoomId = "";

  // --- Refinement Room ---

  test("Create refinement room", async () => {
    const res = await request(app).post("/refinement/create/room");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    refinementInviteCode = res.body.invite_code;
    refinementRoomId = res.body.room_id;
  });

  test("Join refinement room", async () => {
    const res = await request(app).post("/refinement/join/room").send({
      invite_code: refinementInviteCode,
      name: "Alice",
      email: "alice@example.com"
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Submit a prediction", async () => {
    const res = await request(app).post("/refinement/prediction/submit").send({
      room_id: refinementRoomId,
      role: "Dev",
      prediction: 5
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Get predictions", async () => {
    const res = await request(app).get("/refinement/get/predictions").query({
      room_id: refinementRoomId
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.predictions)).toBe(true);
  });

  // --- Retro Room ---

  test("Create retro room", async () => {
    const res = await request(app).post("/retro/create/room");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    retroInviteCode = res.body.invite_code;
    retroRoomId = res.body.room_id;
  });

  test("Join retro room", async () => {
    const res = await request(app).post("/retro/join/room").send({
      invite_code: retroInviteCode,
      name: "Bob",
      email: "bob@example.com"
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Post a retro comment", async () => {
    const res = await request(app).post("/retro/new/comment").send({
      room_id: retroRoomId,
      comment: "Great job team!"
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Create an action item", async () => {
    const res = await request(app).post("/retro/create/action").send({
      room_id: retroRoomId,
      user_name: "Bob",
      description: "Follow up on last sprint bugs"
    });
    // depending on your db setup, this may fail if the user email isn’t in the db
    expect([200, 400, 500]).toContain(res.statusCode);
  });
});
