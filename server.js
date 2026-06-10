const express = require("express");
const path = require("path");

const app = express();

app.use(express.static("public"));

app.use(
  "/pdfjs",
  express.static(
    path.join(
      __dirname,
      "node_modules",
      "pdfjs-dist",
      "build"
    )
  )
);

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});