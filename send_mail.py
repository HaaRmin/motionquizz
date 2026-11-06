#!/usr/bin/env python3
"""Email the latest quiz video (out/latest.json) as an attachment.

Choose the sender with environment variables; whichever is set first wins:
  Resend API : RESEND_API_KEY
  SMTP       : SMTP_HOST, SMTP_PORT (587 = STARTTLS, 465 = SSL), SMTP_USER, SMTP_PASSWORD
Always      : MAIL_FROM, MAIL_TO (comma-separated)

  python send_mail.py                 # send
  python send_mail.py --dry-run       # write out/latest.eml instead of sending
"""
import argparse
import base64
import json
import os
import smtplib
import ssl
import sys
import urllib.request
from email.message import EmailMessage
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIND_LABEL = {"kepes": "képes", "szoveges": "szöveges"}


def build(latest):
    kind = KIND_LABEL.get(latest["kind"], latest["kind"])
    subject = f"HSK kvíz – {kind}, HSK {'+'.join(latest['levels'])} – {latest['name']}"
    lines = [f"{it['han']}  {it['pinyin']}  – {it['en']}" for it in latest["items"]]
    body = (f"Elkészült az új {kind} kvíz ({len(lines)} kérdés).\n\n" + "\n".join(lines) +
            f"\n\nSeed: {latest['seed']}\n")
    return subject, body


def send_resend(key, sender, to, subject, body, attachment):
    payload = {"from": sender, "to": to, "subject": subject, "text": body,
               "attachments": [{"filename": attachment.name,
                                "content": base64.b64encode(attachment.read_bytes()).decode()}]}
    req = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        print("Resend:", r.status, r.read().decode()[:200])


def mime(sender, to, subject, body, attachment):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, ", ".join(to), subject
    msg.set_content(body)
    msg.add_attachment(attachment.read_bytes(), maintype="video", subtype="mp4", filename=attachment.name)
    return msg


def send_smtp(msg):
    host, port = os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587"))
    user, pw = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
    ctx = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=120)
    else:
        server = smtplib.SMTP(host, port, timeout=120)
        server.starttls(context=ctx)
    with server:
        if user:
            server.login(user, pw)
        server.send_message(msg)
    print(f"SMTP: sent via {host}:{port}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latest", default=str(HERE / "out" / "latest.json"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    latest = json.loads(Path(a.latest).read_text(encoding="utf-8"))
    if not latest.get("mp4") or not Path(latest["mp4"]).exists():
        sys.exit("No MP4 in latest.json - run quiz_gen.py with --mp4 first")
    video = Path(latest["mp4"])
    subject, body = build(latest)
    sender = os.environ.get("MAIL_FROM", "quiz@example.com")
    to = [x.strip() for x in os.environ.get("MAIL_TO", "").split(",") if x.strip()]
    size_mb = video.stat().st_size / 1e6
    print(f"{video.name}: {size_mb:.1f} MB")
    if size_mb > 24:
        print("Warning: attachment over ~24 MB; many mail servers reject this", file=sys.stderr)

    if a.dry_run:
        eml = Path(a.latest).with_name("latest.eml")
        eml.write_bytes(bytes(mime(sender, to or ["dry-run@example.com"], subject, body, video)))
        print(f"Dry run: {eml}\nSubject: {subject}\n{body}")
        return
    if not to:
        sys.exit("MAIL_TO is not set")
    if os.environ.get("RESEND_API_KEY"):
        send_resend(os.environ["RESEND_API_KEY"], sender, to, subject, body, video)
    elif os.environ.get("SMTP_HOST"):
        send_smtp(mime(sender, to, subject, body, video))
    else:
        sys.exit("No mail sender configured: set RESEND_API_KEY or SMTP_HOST (see README)")


if __name__ == "__main__":
    main()
