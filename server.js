const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "honvanviet-admin";
const DATA_FILE = path.join(__dirname, "data", "registrations.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function ensureDataFile() {
  const dataDir = path.dirname(DATA_FILE);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
}

function readRegistrations() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function writeRegistrations(items) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { message: "Không tìm thấy tài nguyên." });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";

  response.writeHead(200, { "Content-Type": mimeType });
  fs.createReadStream(filePath).pipe(response);
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Payload quá lớn"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function validateRegistration(payload) {
  const fullName = String(payload.fullName || "").trim();
  const phone = String(payload.phone || "").trim();
  const grade = String(payload.grade || "").trim();
  const note = String(payload.note || "").trim();

  if (!fullName || fullName.length < 2) {
    return { ok: false, message: "Vui lòng nhập họ và tên hợp lệ." };
  }

  if (!phone || phone.length < 8) {
    return { ok: false, message: "Vui lòng nhập số điện thoại hợp lệ." };
  }

  if (!grade) {
    return { ok: false, message: "Vui lòng chọn lớp học quan tâm." };
  }

  return {
    ok: true,
    data: {
      id: randomUUID(),
      fullName,
      phone,
      grade,
      note,
      createdAt: new Date().toISOString()
    }
  };
}

function getOverview() {
  const registrations = readRegistrations();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = registrations.filter((item) => item.createdAt.startsWith(today)).length;
  const recentRegistrations = registrations
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 4);

  return {
    totalRegistrations: registrations.length,
    todayRegistrations: todayCount,
    latestRegistrationAt: recentRegistrations[0]?.createdAt || null,
    recentRegistrations
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/") {
    sendFile(response, path.join(__dirname, "index.html"));
    return;
  }

  if (request.method === "GET" && pathname === "/admin") {
    sendFile(response, path.join(__dirname, "admin.html"));
    return;
  }

  if (request.method === "GET" && pathname === "/api/overview") {
    sendJson(response, 200, getOverview());
    return;
  }

  if (request.method === "GET" && pathname === "/api/registrations") {
    const key = url.searchParams.get("key");

    if (key !== ADMIN_KEY) {
      sendJson(response, 401, { message: "Khóa quản trị không hợp lệ." });
      return;
    }

    const registrations = readRegistrations()
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sendJson(response, 200, { registrations });
    return;
  }

  if (request.method === "POST" && pathname === "/api/registrations") {
    try {
      const rawBody = await collectBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const result = validateRegistration(payload);

      if (!result.ok) {
        sendJson(response, 400, { message: result.message });
        return;
      }

      const registrations = readRegistrations();
      registrations.push(result.data);
      writeRegistrations(registrations);

      sendJson(response, 201, {
        message: "Đăng ký thành công. Hồn Văn Việt sẽ liên hệ với bạn sớm.",
        registration: result.data
      });
    } catch (error) {
      sendJson(response, 500, { message: "Không thể lưu thông tin đăng ký lúc này." });
    }
    return;
  }

  const safePath = path.normalize(path.join(__dirname, pathname));
  const isInsideWorkspace = safePath.startsWith(__dirname);

  if (request.method === "GET" && isInsideWorkspace && fs.existsSync(safePath)) {
    sendFile(response, safePath);
    return;
  }

  sendJson(response, 404, { message: "Trang bạn tìm không tồn tại." });
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Hồn Văn Việt đang chạy tại http://127.0.0.1:${PORT}`);
  console.log(`Trang quản trị: http://127.0.0.1:${PORT}/admin?key=${ADMIN_KEY}`);
});
