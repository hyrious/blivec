# Changelog

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
