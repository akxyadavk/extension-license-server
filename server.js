const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// Demo database.
// Server restart होने पर data reset हो जाएगा.
// अगले step में permanent database जोड़ेंगे.
const licenses = new Map();

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Extension License Server Running"
  });
});

// License activate / verify
app.post("/api/license/verify", (req, res) => {
  const { licenseKey, deviceId } = req.body;

  if (!licenseKey || !deviceId) {
    return res.status(400).json({
      success: false,
      message: "LICENSE_KEY_OR_DEVICE_MISSING"
    });
  }

  const license = licenses.get(licenseKey);

  if (!license) {
    return res.status(404).json({
      success: false,
      message: "INVALID_LICENSE"
    });
  }

  if (license.status !== "ACTIVE") {
    return res.status(403).json({
      success: false,
      message: "LICENSE_DISABLED"
    });
  }

  if (license.expiresAt && new Date() > new Date(license.expiresAt)) {
    return res.status(403).json({
      success: false,
      message: "LICENSE_EXPIRED"
    });
  }

  // पहली बार इसी device से bind
  if (!license.deviceId) {
    license.deviceId = deviceId;
    license.activatedAt = new Date().toISOString();

    return res.json({
      success: true,
      message: "LICENSE_ACTIVATED"
    });
  }

  // उसी device पर valid
  if (license.deviceId === deviceId) {
    return res.json({
      success: true,
      message: "LICENSE_VALID"
    });
  }

  // दूसरे device पर reject
  return res.status(403).json({
    success: false,
    message: "LICENSE_ALREADY_USED"
  });
});

// अभी testing के लिए license बनाने का endpoint.
// Deploy करने से पहले इसे admin password से secure करेंगे.
app.post("/api/admin/create-license", (req, res) => {
  const licenseKey =
    "AK-" + crypto.randomBytes(8).toString("hex").toUpperCase();

  licenses.set(licenseKey, {
    status: "ACTIVE",
    deviceId: null,
    activatedAt: null,
    expiresAt: req.body.expiresAt || null
  });

  res.json({
    success: true,
    licenseKey
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`License Server running on port ${PORT}`);
});
