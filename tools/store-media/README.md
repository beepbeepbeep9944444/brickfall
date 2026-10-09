# Store media

Renders the CrazyGames cover images and preview videos from the game itself.

```bash
node tools/store-media/server.mjs .
```

Then open http://localhost:8130/cover.html (writes the three covers to `covers/`), and after that
http://localhost:8130/video.html (writes the two 18-second MP4s to `covers/`; it plays the covers
first, so render those first). The videos are encoded in the browser with WebCodecs and
mp4-muxer, so no ffmpeg is needed.
