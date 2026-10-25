import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle
import cv2
import subprocess
import imageio_ffmpeg

OUT_RAW = os.path.join(os.path.dirname(__file__), "..", "public", "videos", "demo_raw.mp4")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "videos", "demo.mp4")
TMP = os.path.join(os.path.dirname(__file__), "_slides")
W, H = 1280, 720
DPI = 100
FPS = 30
TRANSITION = 0.6

os.makedirs(os.path.dirname(OUT), exist_ok=True)
os.makedirs(TMP, exist_ok=True)

def gradient_bg(ax):
    ys = np.linspace(0, 1, H)[:, None, None]
    c1 = np.array([11, 6, 23]) / 255.0
    c2 = np.array([26, 14, 46]) / 255.0
    bg = c1 * (1 - ys) + c2 * ys
    bg = np.broadcast_to(bg, (H, W, 3)).copy()
    ax.imshow(bg, extent=[0, 12.8, 0, 7.2], aspect="auto", zorder=0)

def card(ax, x, y, w, h, fc=(0.12, 0.07, 0.20), ec=(0.32, 0.22, 0.45), radius=0.18, lw=1.5):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={radius}",
                       facecolor=fc, edgecolor=ec, linewidth=lw, zorder=2)
    ax.add_patch(p)

def text(ax, s, x, y, size=22, color="white", weight="normal", ha="left", va="center", z=3, alpha=1.0):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, zorder=z, alpha=alpha)

def bullet(ax, s, x, y, size=16, color="#e8e4f0"):
    text(ax, "●", x, y, size=size, color="#daaf37", weight="bold")
    text(ax, s, x + 0.35, y, size=size, color=color)

def make_fig():
    fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 12.8)
    ax.set_ylim(0, 7.2)
    ax.axis("off")
    gradient_bg(ax)
    return fig, ax

def save_fig(fig, idx):
    path = os.path.join(TMP, f"slide_{idx:02d}.png")
    fig.savefig(path, dpi=DPI, facecolor="none")
    plt.close(fig)
    return path

def slide_intro():
    fig, ax = make_fig()
    for r in [3.5, 2.8, 2.1]:
        c = Circle((6.4, 3.6), r, facecolor=(0.55, 0.36, 0.96), edgecolor="none", alpha=0.06, zorder=1)
        ax.add_patch(c)
    text(ax, "TrustVault", 6.4, 4.6, size=64, color="white", weight="bold", ha="center")
    text(ax, "Secure Document Management System", 6.4, 3.9, size=24, color="#daaf37", weight="semibold", ha="center")
    text(ax, "Upload  ·  Organize  ·  Share  ·  Approve  ·  Analyze", 6.4, 3.2, size=16, color="#b8a9d9", ha="center")
    pillars = [("Secure Access", "JWT auth, RBAC, permission grants"), ("Smart Workflows", "Automated routing & approvals"), ("Live Analytics", "Trends, accuracy & audit trails")]
    for i, (t, d) in enumerate(pillars):
        x = 1.2 + i * 3.7
        card(ax, x, 1.2, 3.2, 1.5, fc=(0.16, 0.10, 0.26))
        text(ax, t, x + 1.6, 2.15, size=18, color="white", weight="bold", ha="center")
        text(ax, d, x + 1.6, 1.75, size=13, color="#b8a9d9", ha="center")
    text(ax, "Demo overview  •  trustvault.app", 6.4, 0.5, size=12, color="#6b5f85", ha="center")
    return save_fig(fig, 0)

def slide_auth():
    fig, ax = make_fig()
    text(ax, "Sign In & Register", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Secure JWT-based authentication with role-based access", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 1.0, 5.0, 4.4, fc=(0.14, 0.09, 0.23))
    text(ax, "Login", 3.5, 4.9, size=20, color="white", weight="bold", ha="center")
    for i, label in enumerate(["Email address", "Password"]):
        y = 4.0 - i * 0.9
        card(ax, 1.6, y - 0.25, 3.8, 0.5, fc=(0.20, 0.13, 0.32), ec=(0.35, 0.24, 0.5))
        text(ax, label, 1.8, y, size=13, color="#9c8fb8")
    card(ax, 1.6, 2.0, 3.8, 0.55, fc=(0.55, 0.36, 0.96), ec=(0.7, 0.5, 1.0))
    text(ax, "Sign in", 3.5, 2.28, size=15, color="white", weight="bold", ha="center")
    text(ax, "Roles: Admin  ·  Owner  ·  Viewer", 3.5, 1.3, size=13, color="#b8a9d9", ha="center")
    items = ["Register as Document Owner or Viewer", "Admin accounts provisioned securely", "Token revocation on logout / password change", "Session hardening & CSRF protection"]
    x0 = 6.6
    for i, b in enumerate(items):
        bullet(ax, b, x0, 4.6 - i * 0.7, size=15)
    card(ax, 6.6, 1.2, 5.2, 2.2, fc=(0.10, 0.06, 0.18))
    text(ax, "Security highlights", 9.2, 3.0, size=15, color="#daaf37", weight="bold", ha="center")
    for i, (k, v) in enumerate([("JWT", "Short-lived access tokens"), ("RBAC", "Role-scoped endpoints"), ("Audit", "Event-level logging")]):
        text(ax, k, 7.0, 2.5 - i * 0.55, size=14, color="white", weight="bold")
        text(ax, v, 8.0, 2.5 - i * 0.55, size=13, color="#b8a9d9")
    return save_fig(fig, 1)

def slide_dashboard():
    fig, ax = make_fig()
    text(ax, "Dashboard Overview", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Real-time analytics at a glance", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 0.8, 5.6, 3.5, fc=(0.12, 0.08, 0.20))
    text(ax, "Processing Volume", 3.8, 3.95, size=15, color="white", weight="bold", ha="center")
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    vals = [42, 58, 47, 73, 65, 38, 52]
    for i, (d, v) in enumerate(zip(days, vals)):
        x = 1.6 + i * 0.7
        h = v / 85.0 * 2.4
        ax.add_patch(FancyBboxPatch((x, 1.1), 0.5, h, boxstyle="round,pad=0,rounding_size=0.08", facecolor=(0.55, 0.36, 0.96), edgecolor="none", zorder=3))
        text(ax, d, x + 0.25, 0.95, size=10, color="#9c8fb8", ha="center")
    card(ax, 7.0, 0.8, 4.8, 3.5, fc=(0.12, 0.08, 0.20))
    text(ax, "Document Types", 9.4, 3.95, size=15, color="white", weight="bold", ha="center")
    import math
    types = [("PDF", 0.38, (0.55, 0.36, 0.96)), ("Images", 0.27, (0.36, 0.65, 0.96)), ("Docs", 0.20, (0.96, 0.55, 0.36)), ("Other", 0.15, (0.45, 0.85, 0.65))]
    start = 90
    cx, cy, r = 9.4, 2.5, 1.1
    for name, frac, col in types:
        ang = frac * 360
        theta = np.linspace(np.deg2rad(start), np.deg2rad(start + ang), 40)
        xs = [cx] + [cx + r * np.cos(t) for t in theta] + [cx]
        ys = [cy] + [cy + r * np.sin(t) for t in theta] + [cy]
        ax.fill(xs, ys, color=col, alpha=0.9, zorder=3)
        start += ang
    for i, (name, frac, col) in enumerate(types):
        text(ax, f"{name} {int(frac * 100)}%", 7.4, 1.1 + i * 0.4, size=12, color=col)
    return save_fig(fig, 2)

def slide_upload():
    fig, ax = make_fig()
    text(ax, "Upload Documents", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Fast, validated file uploads with AI processing", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 1.0, 5.6, 4.6, fc=(0.12, 0.08, 0.20))
    ax.add_patch(FancyBboxPatch((1.6, 2.4), 4.4, 2.2, boxstyle="round,pad=0,rounding_size=0.2", facecolor=(0.16, 0.10, 0.26), edgecolor=(0.55, 0.36, 0.96), linewidth=2, linestyle="--", zorder=3))
    text(ax, "Drag & drop files here", 3.8, 3.7, size=18, color="#b8a9d9", ha="center")
    text(ax, "or click to browse  ·  up to 20 files, 10 MiB each", 3.8, 3.2, size=12, color="#9c8fb8", ha="center")
    for i, (name, status) in enumerate([("invoice_2024.pdf", "Validated"), ("scan.png", "Processing"), ("report.docx", "Queued")]):
        y = 2.0 - i * 0.6
        card(ax, 1.6, y - 0.2, 4.4, 0.45, fc=(0.20, 0.13, 0.32))
        text(ax, name, 1.8, y + 0.02, size=12, color="white")
        col = "#4ade80" if status == "Validated" else ("#fbbf24" if status == "Processing" else "#9c8fb8")
        text(ax, status, 5.6, y + 0.02, size=11, color=col, ha="right")
    items = ["MIME and content signature validation", "Per-file size and count limits", "Background processing with Redis/BullMQ", "OCR, classification, and metadata extraction"]
    for i, b in enumerate(items):
        bullet(ax, b, 7.0, 4.8 - i * 0.7, size=15)
    card(ax, 7.0, 1.2, 4.8, 2.6, fc=(0.10, 0.06, 0.18))
    text(ax, "Processing pipeline", 9.4, 3.4, size=15, color="#daaf37", weight="bold", ha="center")
    stages = ["Upload", "Validate", "OCR", "Classify", "Store"]
    for i, s in enumerate(stages):
        x = 7.4 + i * 0.85
        ax.add_patch(Circle((x, 2.4), 0.32, facecolor=(0.55, 0.36, 0.96), edgecolor="none", zorder=3))
        text(ax, s, x, 2.4, size=9, color="white", weight="bold", ha="center")
        if i < len(stages) - 1:
            ax.annotate("", xy=(x + 0.42, 2.4), xytext=(x + 0.33, 2.4), arrowprops=dict(arrowstyle="->", color="#b8a9d9", lw=1.5))
    return save_fig(fig, 3)

def slide_documents():
    fig, ax = make_fig()
    text(ax, "Document Library", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Search, filter, and manage your documents", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 1.0, 10.8, 4.6, fc=(0.12, 0.08, 0.20))
    headers = ["Name", "Owner", "Category", "Status", "Updated"]
    xs = [1.4, 3.6, 5.6, 7.6, 9.2]
    for h, x in zip(headers, xs):
        text(ax, h, x, 5.15, size=13, color="#daaf37", weight="bold")
    rows = [
        ("Q3 Report.pdf", "alice", "Finance", "Approved", "2h ago"),
        ("Contract.docx", "bob", "Legal", "Pending", "1d ago"),
        ("Scan_004.png", "carol", "HR", "Processed", "3d ago"),
        ("Budget.xlsx", "alice", "Finance", "Approved", "5d ago"),
        ("Policy.pdf", "admin", "Compliance", "Archived", "1w ago"),
    ]
    for i, (n, o, c, s, u) in enumerate(rows):
        y = 4.6 - i * 0.75
        card(ax, 1.2, y - 0.25, 10.4, 0.55, fc=(0.16, 0.10, 0.26))
        vals = [n, o, c, s, u]
        for v, x in zip(vals, xs):
            col = "white"
            if v in ("Approved", "Processed"):
                col = "#4ade80"
            elif v == "Pending":
                col = "#fbbf24"
            text(ax, v, x, y + 0.02, size=12, color=col)
    text(ax, "Filter by name, owner, category, date  ·  Owner-only metadata editing  ·  Named read/edit grants", 6.4, 0.6, size=12, color="#b8a9d9", ha="center")
    return save_fig(fig, 4)

def slide_workflow():
    fig, ax = make_fig()
    text(ax, "Approvals & Workflows", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Automated document routing and approval queues", 1.0, 5.9, size=16, color="#b8a9d9")
    steps = ["Upload", "Validate", "Route", "Review", "Approve", "Archive"]
    for i, s in enumerate(steps):
        x = 1.2 + i * 1.85
        card(ax, x, 3.6, 1.5, 1.2, fc=(0.18, 0.11, 0.30))
        ax.add_patch(Circle((x + 0.75, 4.4), 0.28, facecolor=(0.55, 0.36, 0.96), edgecolor="none", zorder=3))
        text(ax, str(i + 1), x + 0.75, 4.4, size=14, color="white", weight="bold", ha="center")
        text(ax, s, x + 0.75, 3.95, size=13, color="white", weight="bold", ha="center")
        if i < len(steps) - 1:
            ax.annotate("", xy=(x + 1.55, 4.4), xytext=(x + 1.5, 4.4), arrowprops=dict(arrowstyle="->", color="#daaf37", lw=2))
    rules = ["Configurable workflow rules per category", "Approval queues with escalation timers", "Background jobs via Redis / BullMQ", "Notifications to owners and reviewers"]
    for i, b in enumerate(rules):
        bullet(ax, b, 1.2, 2.6 - i * 0.6, size=15)
    card(ax, 7.4, 1.0, 4.4, 3.2, fc=(0.10, 0.06, 0.18))
    text(ax, "Queue status", 9.6, 3.8, size=15, color="#daaf37", weight="bold", ha="center")
    for i, (name, n, col) in enumerate([("Pending", 12, "#fbbf24"), ("In review", 5, "#60a5fa"), ("Approved", 84, "#4ade80"), ("Rejected", 3, "#f87171")]):
        y = 3.3 - i * 0.65
        text(ax, name, 7.8, y, size=13, color="white")
        ax.add_patch(FancyBboxPatch((9.2, y - 0.18), 2.2, 0.32, boxstyle="round,pad=0,rounding_size=0.1", facecolor=(0.20, 0.13, 0.32), edgecolor="none", zorder=3))
        ax.add_patch(FancyBboxPatch((9.2, y - 0.18), 2.2 * (n / 90.0), 0.32, boxstyle="round,pad=0,rounding_size=0.1", facecolor=col, edgecolor="none", zorder=4))
        text(ax, str(n), 11.5, y, size=12, color=col, ha="right")
    return save_fig(fig, 5)

def slide_analytics():
    fig, ax = make_fig()
    text(ax, "Analytics & Activity", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Insights, trends, and audit trails", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 3.4, 5.6, 2.8, fc=(0.12, 0.08, 0.20))
    text(ax, "Processing accuracy trend", 3.8, 5.85, size=15, color="white", weight="bold", ha="center")
    xs = np.linspace(1.4, 6.2, 12)
    ys = 3.8 + np.array([0.2, 0.35, 0.3, 0.5, 0.45, 0.6, 0.55, 0.7, 0.65, 0.75, 0.8, 0.85])
    ax.plot(xs, ys, color=(0.55, 0.36, 0.96), linewidth=3, zorder=3)
    ax.fill_between(xs, 3.6, ys, color=(0.55, 0.36, 0.96), alpha=0.18, zorder=2)
    for x, y in zip(xs[::3], ys[::3]):
        ax.add_patch(Circle((x, y), 0.07, facecolor=(0.85, 0.69, 0.22), edgecolor="none", zorder=4))
    card(ax, 7.0, 3.4, 4.8, 2.8, fc=(0.12, 0.08, 0.20))
    text(ax, "Recent activity", 9.4, 5.85, size=15, color="white", weight="bold", ha="center")
    acts = ["alice uploaded Q3 Report", "bob approved Contract", "carol edited metadata", "admin revoked a session", "System processed 42 files"]
    for i, a in enumerate(acts):
        text(ax, "●", 7.3, 5.4 - i * 0.5, size=10, color="#daaf37")
        text(ax, a, 7.6, 5.4 - i * 0.5, size=12, color="#e8e4f0")
    card(ax, 1.0, 0.8, 10.8, 2.3, fc=(0.10, 0.06, 0.18))
    text(ax, "Admin audit event viewer  ·  Processing trends  ·  Accuracy metrics  ·  Storage usage", 6.4, 1.95, size=14, color="#b8a9d9", ha="center")
    return save_fig(fig, 6)

def slide_settings():
    fig, ax = make_fig()
    text(ax, "Settings & Storage", 1.0, 6.4, size=36, color="white", weight="bold")
    text(ax, "Configure your workspace and integrations", 1.0, 5.9, size=16, color="#b8a9d9")
    card(ax, 1.0, 1.0, 5.2, 4.6, fc=(0.12, 0.08, 0.20))
    text(ax, "Profile", 3.6, 5.1, size=16, color="white", weight="bold", ha="center")
    card(ax, 1.6, 4.0, 4.0, 0.9, fc=(0.16, 0.10, 0.26))
    text(ax, "Display name, email, password", 3.6, 4.45, size=12, color="#b8a9d9", ha="center")
    card(ax, 1.6, 2.9, 4.0, 0.9, fc=(0.16, 0.10, 0.26))
    text(ax, "Notifications & preferences", 3.6, 3.35, size=12, color="#b8a9d9", ha="center")
    card(ax, 1.6, 1.8, 4.0, 0.9, fc=(0.16, 0.10, 0.26))
    text(ax, "Cloud storage integration", 3.6, 2.25, size=12, color="#b8a9d9", ha="center")
    card(ax, 6.6, 1.0, 5.2, 4.6, fc=(0.12, 0.08, 0.20))
    text(ax, "Storage usage", 9.2, 5.1, size=16, color="white", weight="bold", ha="center")
    ax.add_patch(FancyBboxPatch((7.2, 4.0), 4.0, 0.4, boxstyle="round,pad=0,rounding_size=0.15", facecolor=(0.20, 0.13, 0.32), edgecolor="none", zorder=3))
    ax.add_patch(FancyBboxPatch((7.2, 4.0), 4.0 * 0.62, 0.4, boxstyle="round,pad=0,rounding_size=0.15", facecolor=(0.55, 0.36, 0.96), edgecolor="none", zorder=4))
    text(ax, "62% used  ·  12.4 GB of 20 GB", 9.2, 3.6, size=12, color="#b8a9d9", ha="center")
    for i, (k, v) in enumerate([("Encryption", "AES-256 at rest"), ("Backups", "Daily snapshots"), ("Compliance", "GDPR ready")]):
        text(ax, k, 7.2, 2.8 - i * 0.6, size=13, color="white", weight="bold")
        text(ax, v, 8.6, 2.8 - i * 0.6, size=12, color="#b8a9d9")
    return save_fig(fig, 7)

def slide_outro():
    fig, ax = make_fig()
    for r in [3.2, 2.5, 1.8]:
        c = Circle((6.4, 3.6), r, facecolor=(0.55, 0.36, 0.96), edgecolor="none", alpha=0.05, zorder=1)
        ax.add_patch(c)
    text(ax, "Thank You", 6.4, 4.8, size=56, color="white", weight="bold", ha="center")
    text(ax, "Start managing documents securely today", 6.4, 4.0, size=20, color="#daaf37", ha="center")
    card(ax, 3.4, 2.2, 6.0, 1.4, fc=(0.16, 0.10, 0.26))
    text(ax, "TrustVault  ·  Secure. Smart. Simple.", 6.4, 2.9, size=18, color="white", weight="bold", ha="center")
    text(ax, "trustvault.app  ·  demo@trustvault.app", 6.4, 2.45, size=13, color="#b8a9d9", ha="center")
    return save_fig(fig, 8)

slides = [slide_intro(), slide_auth(), slide_dashboard(), slide_upload(), slide_documents(),
          slide_workflow(), slide_analytics(), slide_settings(), slide_outro()]

# durations per slide
durations = [4.0, 4.5, 5.0, 5.0, 5.0, 5.0, 5.0, 4.5, 3.5]

writer = cv2.VideoWriter(OUT_RAW, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
assert writer.isOpened(), "cannot open writer"

imgs = [cv2.imread(p) for p in slides]
trans_frames = int(TRANSITION * FPS)
for idx, (img, dur) in enumerate(zip(imgs, durations)):
    n = int(dur * FPS)
    show = n - (trans_frames if idx < len(imgs) - 1 else 0)
    for _ in range(max(1, show)):
        writer.write(img)
    if idx < len(imgs) - 1:
        nxt = imgs[idx + 1]
        for k in range(trans_frames):
            a = (k + 1) / trans_frames
            blended = cv2.addWeighted(img, 1 - a, nxt, a, 0)
            writer.write(blended)

writer.release()
print("Raw video written")

# Convert to browser-compatible H.264
try:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ffmpeg, "-y", "-i", OUT_RAW,
                    "-c:v", "libx264", "-preset", "medium", "-crf", "22",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(OUT_RAW)
    # cleanup slides
    for p in slides:
        try:
            os.remove(p)
        except OSError:
            pass
    try:
        os.rmdir(TMP)
    except OSError:
        pass
    print("Generated", OUT)
except Exception as e:
    os.replace(OUT_RAW, OUT)
    print("Generated (mp4v fallback)", OUT, e)
