const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

if (!ADMIN_SECRET) {
  console.error("ADMIN_SECRET missing");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id BIGSERIAL PRIMARY KEY,
      license_key VARCHAR(100) UNIQUE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      device_id TEXT,
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("Database initialized");
}

function checkAdmin(req, res, next) {
  const suppliedSecret = req.get("x-admin-secret");

  if (!suppliedSecret || suppliedSecret !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      message: "UNAUTHORIZED"
    });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Extension License Server Running"
  });
});

// LICENSE ACTIVATE / VERIFY
app.post("/api/license/verify", async (req, res) => {
  try {
    const licenseKey = String(req.body.licenseKey || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!licenseKey || !deviceId) {
      return res.status(400).json({
        success: false,
        message: "LICENSE_KEY_OR_DEVICE_MISSING"
      });
    }

    await pool.query("BEGIN");

    const result = await pool.query(
      `
      SELECT *
      FROM licenses
      WHERE license_key = $1
      FOR UPDATE
      `,
      [licenseKey]
    );

    if (result.rowCount === 0) {
      await pool.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "INVALID_LICENSE"
      });
    }

    const license = result.rows[0];

    if (license.status !== "ACTIVE") {
      await pool.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message: "LICENSE_DISABLED"
      });
    }

    if (
      license.expires_at &&
      new Date() > new Date(license.expires_at)
    ) {
      await pool.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message: "LICENSE_EXPIRED"
      });
    }

    // FIRST ACTIVATION
    if (!license.device_id) {
      await pool.query(
        `
        UPDATE licenses
        SET device_id = $1,
            activated_at = NOW()
        WHERE license_key = $2
        `,
        [deviceId, licenseKey]
      );

      await pool.query("COMMIT");

      return res.json({
        success: true,
        message: "LICENSE_ACTIVATED"
      });
    }

    // SAME DEVICE
    if (license.device_id === deviceId) {
      await pool.query("COMMIT");

      return res.json({
        success: true,
        message: "LICENSE_VALID"
      });
    }

    // DIFFERENT DEVICE
    await pool.query("ROLLBACK");

    return res.status(403).json({
      success: false,
      message: "LICENSE_ALREADY_USED"
    });

  } catch (error) {
    try {
      await pool.query("ROLLBACK");
    } catch (_) {}

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR"
    });
  }
});

// CREATE LICENSE
app.post(
  "/api/admin/create-license",
  checkAdmin,
  async (req, res) => {
    try {
      const licenseKey =
        "AK-" +
        crypto.randomBytes(8).toString("hex").toUpperCase();

      const expiresAt = req.body.expiresAt || null;

      await pool.query(
        `
        INSERT INTO licenses
        (license_key, status, expires_at)
        VALUES ($1, 'ACTIVE', $2)
        `,
        [licenseKey, expiresAt]
      );

      return res.json({
        success: true,
        licenseKey,
        expiresAt
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "SERVER_ERROR"
      });
    }
  }
);

// DISABLE LICENSE
app.post(
  "/api/admin/disable-license",
  checkAdmin,
  async (req, res) => {
    try {
      const licenseKey =
        String(req.body.licenseKey || "").trim();

      const result = await pool.query(
        `
        UPDATE licenses
        SET status = 'DISABLED'
        WHERE license_key = $1
        `,
        [licenseKey]
      );

      return res.json({
        success: true,
        updated: result.rowCount
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "SERVER_ERROR"
      });
    }
  }
);

// RESET DEVICE
app.post(
  "/api/admin/reset-device",
  checkAdmin,
  async (req, res) => {
    try {
      const licenseKey =
        String(req.body.licenseKey || "").trim();

      const result = await pool.query(
        `
        UPDATE licenses
        SET device_id = NULL,
            activated_at = NULL
        WHERE license_key = $1
        `,
        [licenseKey]
      );

      return res.json({
        success: true,
        updated: result.rowCount
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "SERVER_ERROR"
      });
    }
  }
);

// LIST LICENSES
app.get(
  "/api/admin/licenses",
  checkAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          license_key,
          status,
          device_id,
          activated_at,
          expires_at,
          created_at
        FROM licenses
        ORDER BY created_at DESC
      `);

      return res.json({
        success: true,
        licenses: result.rows
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "SERVER_ERROR"
      });
    }
  }
);

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`License Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
