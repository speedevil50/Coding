const express = require("express");
const Bonjour = require("bonjour-service");
const { spawn } = require("child_process");
const os = require("os");
const { WebSocketServer } = require("ws");


const app = express();
const port = 7000;
const hostname = os.hostname();

// Serve a simple video page
app.get("/", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>iPhone Cast</title>
    <style>
      body { margin: 0; background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; }
      video { width: 100%; height: auto; max-height: 100vh; }
    </style>
  </head>
  <body>
    <video id="video" autoplay playsinline controls muted></video>
    <script>
      const ws = new WebSocket("ws://" + location.host);
      const video = document.getElementById("video");
      const mediaSource = new MediaSource();
      video.src = URL.createObjectURL(mediaSource);
      let sourceBuffer;

      mediaSource.addEventListener("sourceopen", () => {
        sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
      });

      ws.onmessage = (msg) => {
        if (sourceBuffer && !sourceBuffer.updating) {
          sourceBuffer.appendBuffer(new Uint8Array(msg.data));
        }
      };
    </script>
  </body>
  </html>
  `);
});

const wss = new WebSocketServer({ noServer: true });

const server = app.listen(port, () => {
  console.log(`[+] AirPlay browser server on http://localhost:${port}`);
});

const bonjour = new Bonjour();
bonjour.publish({
  name: `${hostname}-WebCast`,
  type: "airplay",
  port,
  txt: {
    deviceid: "A1:B2:C3:D4:E5:F6",
    model: "AppleTV3,2",
    srcvers: "220.68",
    features: "0x5A7FFFF7,0x1E",
  },
});
console.log(`[+] Advertising as ${hostname}-WebCast`);


// WebSocket + FFmpeg pipeline
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  console.log("[+] WebSocket connection open for video stream");

  const ffmpeg = spawn("ffmpeg", [
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ]);

  ffmpeg.stdout.on("data", (chunk) => ws.send(chunk));
  ffmpeg.stderr.on("data", (d) => console.log(d.toString()));
  ffmpeg.on("close", () => ws.close());

  ws.on("close", () => ffmpeg.kill("SIGINT"));
});
