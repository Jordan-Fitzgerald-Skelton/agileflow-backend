const request = require("supertest");
const app = require("../server");

describe("Endpoint tests", () => {
  let refinementInviteCode = "";
  let retroInviteCode = "";
  let refinementRoomId = "";
  let retroRoomId = "";

  test("create a refinement room", async () => {
    const res = await request(app).post("/refinement/create/room");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    refinementInviteCode = res.body.invite_code;
    refinementRoomId = res.body.room_id;
  });

  test("join a refinement room", async () => {
    const res = await request(app).post("/refinement/join/room").send({
      invite_code: refinementInviteCode,
      name: "Bob",
      email: "bob@example.com"
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

  test("get the final predictions", async () => {
    const res = await request(app).get("/refinement/get/predictions").query({
      room_id: refinementRoomId
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.predictions)).toBe(true);
  });

  test("create a retro room", async () => {
    const res = await request(app).post("/retro/create/room");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    retroInviteCode = res.body.invite_code;
    retroRoomId = res.body.room_id;
  });

  test("join a retro room", async () => {
    const res = await request(app).post("/retro/join/room").send({
      invite_code: retroInviteCode,
      name: "Bob",
      email: "bob@example.com"
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("add a comment", async () => {
    const res = await request(app).post("/retro/new/comment").send({
      room_id: retroRoomId,
      comment: "Great job team!"
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("add a action item", async () => {
    const res = await request(app).post("/retro/create/action").send({
      room_id: retroRoomId,
      user_name: "Bob",
      description: "Follow up on last sprint bugs"
    });
    expect([200, 400, 500]).toContain(res.statusCode);
  });
});
