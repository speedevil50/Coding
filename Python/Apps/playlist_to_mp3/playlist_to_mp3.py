import argparse
import logging
import os
import subprocess
import sys
import threading
import time

RATE_LIMIT_DELAY_SECONDS = 5
MAX_RATE_LIMIT_RETRIES = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(message)s"
LOGGER_NAME = "playlist_to_mp3"


def configure_logging(debug=False, log_file=None):
    level = logging.DEBUG if debug else logging.INFO
    handlers = None
    if log_file:
        handlers = [logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler()]
    logging.basicConfig(level=level, format=LOG_FORMAT, handlers=handlers)


def build_command(url, output_dir, is_playlist, skip_existing, embed_metadata, verbose=False):
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-x",  # extract audio
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",  # best quality
        "-o",
        os.path.join(output_dir, "%(title)s.%(ext)s"),
    ]

    if is_playlist:
        command.append("--yes-playlist")
    else:
        command.append("--no-playlist")

    if skip_existing:
        command.append("--no-overwrites")

    if embed_metadata:
        command.extend(
            [
                "--add-metadata",
                "--embed-metadata",
                "--embed-thumbnail",
            ]
        )

    if verbose:
        command.append("-v")

    command.append(url)
    return command


def _stream_pipe(pipe, sink, log_fn):
    for line in iter(pipe.readline, ""):
        line = line.rstrip("\n")
        if line:
            sink.append(line)
            log_fn(line)
    pipe.close()


def download_to_mp3(
    url,
    output_dir="downloads",
    is_playlist=True,
    skip_existing=False,
    embed_metadata=False,
    verbose=False,
):
    logger = logging.getLogger(LOGGER_NAME)
    logger.info("Starting download (url=%s, output_dir=%s)", url, output_dir)
    os.makedirs(output_dir, exist_ok=True)
    logger.info("Ensured output directory exists: %s", output_dir)
    command = build_command(
        url,
        output_dir,
        is_playlist,
        skip_existing,
        embed_metadata,
        verbose=verbose,
    )
    logger.info("Command ready: %s", " ".join(command))

    attempts = 0
    while True:
        logger.info("Running yt-dlp (attempt=%s)", attempts + 1)
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        stdout_lines = []
        stderr_lines = []
        stdout_thread = threading.Thread(
            target=_stream_pipe,
            args=(process.stdout, stdout_lines, logger.info),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=_stream_pipe,
            args=(process.stderr, stderr_lines, logger.warning),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()
        return_code = process.wait()
        stdout_thread.join()
        stderr_thread.join()

        if return_code == 0:
            logger.info("Download complete.")
            return

        combined = "\n".join(stdout_lines + stderr_lines).lower()
        is_rate_limited = (
            "429" in combined
            or "too many requests" in combined
            or "rate limit" in combined
            or "rate-limited" in combined
        )
        if is_rate_limited and attempts < MAX_RATE_LIMIT_RETRIES:
            attempts += 1
            logger.warning(
                "Rate limit detected. Waiting %ss before retry %s/%s...",
                RATE_LIMIT_DELAY_SECONDS,
                attempts,
                MAX_RATE_LIMIT_RETRIES,
            )
            time.sleep(RATE_LIMIT_DELAY_SECONDS)
            continue

        logger.error("yt-dlp exited with code %s", return_code)
        return


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Download a playlist or single video to MP3 via yt-dlp."
    )
    parser.add_argument("url", help="Playlist or video URL")
    parser.add_argument(
        "-o",
        "--output-dir",
        default="downloads",
        help="Output directory (default: downloads)",
    )
    parser.add_argument(
        "--single",
        action="store_true",
        help="Treat the URL as a single video (no playlist)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip files that already exist",
    )
    parser.add_argument(
        "--embed-metadata",
        action="store_true",
        help="Embed metadata and thumbnail",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument(
        "--log-file",
        help="Write logs to a file (in addition to console)",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    configure_logging(debug=args.debug, log_file=args.log_file)
    download_to_mp3(
        args.url,
        output_dir=args.output_dir,
        is_playlist=not args.single,
        skip_existing=args.skip_existing,
        embed_metadata=args.embed_metadata,
        verbose=args.debug,
    )
