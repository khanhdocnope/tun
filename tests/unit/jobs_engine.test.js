const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const jobsHandler = require(path.join(__dirname, "../../web-in-vercel/api/jobs.js"));

function createMockReqRes({ method = "GET", url = "/api/jobs", body = {}, query = {}, headers = {} }) {
  const req = {
    method,
    url,
    body,
    query,
    headers: { host: "localhost:3000", "x-backend-url": "http://127.0.0.1:9", ...headers },
    on: () => {},
  };

  let statusCode = 200;
  const headersSent = {};
  let responseData = null;

  const res = {
    statusCode,
    setHeader: (k, v) => {
      headersSent[k.toLowerCase()] = v;
    },
    status: (code) => {
      res.statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    },
    write: () => {},
    end: () => res,
    getResponseData: () => responseData,
  };

  return { req, res };
}

test("jobsHandler: rejects creation with empty pages array", async () => {
  const { req, res } = createMockReqRes({
    method: "POST",
    url: "/api/jobs",
    body: { pages: [] },
  });

  await jobsHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.getResponseData().error, /pages/i);
});

test("jobsHandler: creates a valid batch job and returns queued summary", async () => {
  const { req, res } = createMockReqRes({
    method: "POST",
    url: "/api/jobs",
    body: {
      pages: [
        { page_id: "p1", imageBase64: "data:image/png;base64,mock1" },
        { page_id: "p2", imageBase64: "data:image/png;base64,mock2" },
      ],
      defaultOptions: { inpaintModel: "anime-lama" },
    },
  });

  await jobsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const data = res.getResponseData();
  assert.equal(data.success, true);
  assert.ok(data.job);
  assert.ok(data.job.job_id.startsWith("job_"));
  assert.equal(data.job.total_pages, 2);
  assert.equal(data.job.status, "queued");
});

test("jobsHandler: retrieves job status snapshot via GET", async () => {
  // First create
  const { req: createReq, res: createRes } = createMockReqRes({
    method: "POST",
    url: "/api/jobs",
    body: {
      pages: [{ page_id: "p1", imageBase64: "mock" }],
    },
  });
  await jobsHandler(createReq, createRes);
  const createdJob = createRes.getResponseData().job;

  // Then query by ID
  const { req: getReq, res: getRes } = createMockReqRes({
    method: "GET",
    url: `/api/jobs?id=${createdJob.job_id}`,
  });
  await jobsHandler(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  const queryData = getRes.getResponseData();
  assert.equal(queryData.success, true);
  assert.equal(queryData.job.job_id, createdJob.job_id);
  assert.equal(queryData.job.total_pages, 1);
});
