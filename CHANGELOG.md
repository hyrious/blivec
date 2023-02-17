# Changelog

## 0.3.1

- Improve dd mode: wait for first available stream.

## 0.3.0

- Removed `--play` and `--max` in `get` function.
- Added `--json` in `get` function to output json format.
- Added `d` function, it has these flags:
  - `--interval=<minutes>`: Loop querying the live status and play the stream when it's live.\
    Default interval is `1` minute, meaning <samp>loop { sleep(1min); check_live() }</samp>.\
    Set it to `0` to disable the loop so that it only check once and exit if not online.\
    Any value less than `0` will be treated as `0`.
  - `--mpv`: Call `mpv` instead of `ffplay`.

## 0.2.2

- Show danmaku on `--play`.

## 0.2.1

- Added `--play`, `--max` in `get` function.
  - `--play`: Call `ffplay` to play the stream.
  - `--max`: Use the highest quality stream.

## 0.2.0

- Added fetch stream url function.

## 0.1.5

- Fixed closing on first error, it should try to reconnect another server.

## 0.1.4

- Fixed bugs around terminating:

  - SIGINT may receive twice on Windows.
  - Process may hang after sent message.

## 0.1.3

- Added start time info on init.

## 0.1.2

- Remove `fetch()` to prevent warnings.

## 0.1.1

- Support sending danmaku to a room.

## 0.1.0

- Support listening danmaku in one room.
