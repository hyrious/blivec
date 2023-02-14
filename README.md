## <samp>&gt; <ins>b</ins>ilibili-<ins>live</ins>-<ins>c</ins>li</samp>

Personal tool for viewing <ruby>弾幕 <rp>(</rp><rt>danmaku</rt><rp>)</rp></ruby> and other utils in bilibili live streaming.

### Why

It will cost too much CPU to open a browser when playing [osu!](https://osu.ppy.sh/users/hyrious), where the performance of CPU matters when the beatmap becomes more difficult and you need at least 240 FPS to play well.

The main goal of this tool is to provide a cheap way to interact with bilibili live streaming without hurting the game's performance. If you want a better API library, see [credits](#credits).

### Usage

```bash
# start listening danmaku in room 14917277
npx @hyrious/blivec 14917277
[blivc] listening 14917277
[username] message
^C

# install it globally, which provides a shortcut name "bl"
npm i -g @hyrious/blivec
bl 14917277

# send danmaku (requires cookie to be put at cwd)
bl 14917277 "hello world"

# get direct stream url
bl get 14917277
https://.../a.flv?b=c...
```

### Develop

PR & issues are welcome!

```bash
pnpm t 14917277
```

### Credits

- [blivedm](https://github.com/xfgryujk/blivedm)
- [bilibili-live-ws](https://github.com/simon300000/bilibili-live-ws)
- [Bilibili-Live-API](https://github.com/lovelyyoshino/Bilibili-Live-API)
- [bilibili-live-stream](https://github.com/ikexing-cn/bilibili-live-stream)

### License

MIT @ [hyrious](https://github.com/hyrious)
