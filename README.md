# <samp>&gt; <ins>b</ins>ilibili-<ins>live</ins>-<ins>c</ins>li</samp>

[![code style](https://antfu.me/badge-code-style.svg)](https://github.com/antfu/eslint-config)

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

> [!NOTE]
> Many commands require cookies to run correctly.
> Use incognito mode to get the cookie that won't expire easily.

```
  bl <room_id>                      # listen danmaku (requires cookie for
                                      displaying user names)
     --json                         # print all events in json

  bl <room_id> <message>            # send danmaku (requires cookie)

  bl get <room_id>                  # get stream url
     --json                         # print them in json

  bl feed                           # get feed list (requires cookie)
     --json                         # print them in json

  bl d <room_id> [--interval=1]     # dd mode
     --interval=<minutes>           # set 0 to disable polling
     --mpv                          # open in mpv instead
     --on-close=<behavior>          # do something on window close
                default             # restart player    (alias: --default)
                ask                 # ask quality again (alias: --ask)
                quit                # quit DD mode      (alias: --quit)
     -- [...player_args]            # pass args to ffplay or mpv
```

## Develop

PR & issues are welcome!

## Credits

- [blivedm](https://github.com/xfgryujk/blivedm)
- [bilibili-live-ws](https://github.com/simon300000/bilibili-live-ws)
- [Bilibili-Live-API](https://github.com/lovelyyoshino/Bilibili-Live-API)
- [bilibili-live-stream](https://github.com/ikexing-cn/bilibili-live-stream)

## License

MIT @ [hyrious](https://github.com/hyrious)
