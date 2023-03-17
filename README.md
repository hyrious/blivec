# <samp>&gt; <ins>b</ins>ilibili-<ins>live</ins>-<ins>c</ins>li</samp>

Personal tool for viewing <ruby>弾幕 <rp>(</rp><rt>danmaku</rt><rp>)</rp></ruby> and other utils in bilibili live streaming.

## Why

It will cost too much CPU to open a browser when playing [osu!](https://osu.ppy.sh/users/hyrious), where the performance of CPU matters when the beatmap becomes more difficult and you need at least 240 FPS to play well.

The main goal of this tool is to provide a cheap way to interact with bilibili live streaming without hurting the game's performance. If you want a better API library, see [credits](#credits).

## Install

You don't have to install it if you have `npx`,

```bash
npx @hyrious/blivec ...args
```

Or you can choose to install it globally, which will give you a shortcut name `bl`,

```bash
npm i -g @hyrious/blivec
bl ...args
```

## Usage

### Listen Danmaku

```bash
bl <room_id> [--json]
```

### Send Danmaku

```bash
bl <room_id> <message>
```

This command requires a cookie file named `cookie.txt` to be put at the current working directory or at your home folder.

### Get Stream URL

```bash
bl get <room_id> [--json]
```

### DD Mode

```bash
bl d <room_id> [--mpv] [--interval=1] [--on-close=quit] [-- ...player_args]
```

Use `ffplay` or `mpv` (if `--mpv` is specified) to play the stream. If it is not available, wait _interval_ minutes and try again.

- `--mpv`: Use `mpv` instead of `ffplay`.
- `--interval=<minutes>`: Wait minutes before trying again. Default is 1 minute.
- `--on-close=<action>`: What to do when the player window is closed.
  - `default`: Restart the player. This is super useful when there is network errors and you don't have to touch the keyboard or mouse to keep watching the stream.
  - `quit`: Quit the whole program.
  - `ask`: Search stream URLs and ask you for a new one to play or just quit. This is useful when you want to switch the stream quality quickly.

## Develop

PR & issues are welcome!

## Credits

- [blivedm](https://github.com/xfgryujk/blivedm)
- [bilibili-live-ws](https://github.com/simon300000/bilibili-live-ws)
- [Bilibili-Live-API](https://github.com/lovelyyoshino/Bilibili-Live-API)
- [bilibili-live-stream](https://github.com/ikexing-cn/bilibili-live-stream)

## License

MIT @ [hyrious](https://github.com/hyrious)
