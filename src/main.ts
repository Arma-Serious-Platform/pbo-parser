import express from "express";
import cors from "cors";
import { execSync } from 'child_process';
import multer from "multer";

const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(cors());

const uploadPbo = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".pbo")) {
      return cb(new Error("Only .pbo files are allowed"));
    }

    cb(null, true);
  },
});

app.post("/pbo/slots", uploadPbo.single("pbo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Missing file. Please send form-data with file field "pbo".',
    });
  }

  res.json({
    message: "PBO file received successfully",
    fileName: req.file.originalname,
    fileSize: req.file.size,
  });
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});