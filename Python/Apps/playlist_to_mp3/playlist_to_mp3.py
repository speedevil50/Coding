import argparse
import os
import subprocess
import sys

def build_command(url, output_dir, is_playlist, skip_existing, embed_metadata):
    command = [
        "yt-dlp",
        "-x",  # extract audio
        "--audio-format", "mp3",
        "--audio-quality", "0",  # best quality
        "-o", os.path.join(output_dir, "%(title)s.%(ext)s"),
    ]

    if is_playlist:
        command.append("--yes-playlist")
    else:
        command.append("--no-playlist")

    if skip_existing:
        command.append("--no-overwrites")

    if embed_metadata:
        command.extend([
            "--add-metadata",
            "--embed-metadata",
            "--embed-thumbnail",
        ])

    command.append(url)
    return command

def download_to_mp3(url, output_dir="downloads", is_playlist=True, skip_existing=False, embed_metadata=False):
    os.makedirs(output_dir, exist_ok=True)
    command = build_command(url, output_dir, is_playlist, skip_existing, embed_metadata)

    try:
        subprocess.run(command, check=True)
        print("Download complete.")
    except subprocess.CalledProcessError as e:
        print("Error during download:", e)

def parse_args(argv):
    parser = argparse.ArgumentParser(description="Download a playlist or single video to MP3 via yt-dlp.")
    parser.add_argument("url", help="Playlist or video URL")
    parser.add_argument("-o", "--output-dir", default="downloads", help="Output directory (default: downloads)")
    parser.add_argument("--single", action="store_true", help="Treat the URL as a single video (no playlist)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip files that already exist")
    parser.add_argument("--embed-metadata", action="store_true", help="Embed metadata and thumbnail")
    return parser.parse_args(argv)

if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    download_to_mp3(
        args.url,
        output_dir=args.output_dir,
        is_playlist=not args.single,
        skip_existing=args.skip_existing,
        embed_metadata=args.embed_metadata,
    )
