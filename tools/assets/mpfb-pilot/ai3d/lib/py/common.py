"""Shared helpers of the AI-3D fit scripts (ai_body_fit / ai_body_bake / ai_body_render / ai3d_fit ...): paths with the
`ai3d.mjs` overrides, the raw-array reader, smoothing, normals, rigid / similarity alignment, the posed skin matrices.
Pure numpy (no bpy), so a script may import it before or after Blender's modules. Results are the scripts' own
former local definitions, moved here unchanged.

Env (set by ai3d.mjs, all optional; the defaults are the repo's committed layout):
  AI3D_FIT_ROOT    body work root (default <pilot>/ai/fit; the body scripts use <root>/<m|f>)
  AI3D_IDENT_DIR   face identity dump (default <pilot>/ident)
"""
import os, sys, time, math
import numpy as np

PILOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))


def script_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def fit_root():
    return os.environ.get("AI3D_FIT_ROOT") or os.path.join(PILOT, "ai", "fit")


def ident_dir():
    return os.environ.get("AI3D_IDENT_DIR") or os.path.join(PILOT, "ident")


def make_log(tag):
    t0 = time.time()

    def log(*a):
        print(tag, f"{time.time() - t0:6.1f}s", *a, flush=True)
    return log


def reader(d_dir):
    def rd(name, dt, k):
        return np.fromfile(os.path.join(d_dir, name), dt).reshape(-1, k)
    return rd


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def vnormals(X, T):
    fn = np.cross(X[T[:, 1]] - X[T[:, 0]], X[T[:, 2]] - X[T[:, 0]])
    N = np.zeros_like(X)
    for c in range(3):
        np.add.at(N, T[:, c], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)


def umeyama_rigid(src, dst):
    ms, md = src.mean(0), dst.mean(0)
    C = (dst - md).T @ (src - ms)
    Uu, _, Vt = np.linalg.svd(C)
    S = np.eye(3)
    if np.linalg.det(Uu @ Vt) < 0:
        S[2, 2] = -1
    R = Uu @ S @ Vt
    return R, md - ms @ R.T


def umeyama(src, dst, w=None):
    """Similarity (scale s, rotation R, offset t): dst ~ s R src + t (weighted)."""
    src, dst = np.asarray(src, np.float64), np.asarray(dst, np.float64)
    w = np.ones(len(src)) if w is None else np.asarray(w, np.float64)
    w = w / w.sum()
    ms, md = (w[:, None] * src).sum(0), (w[:, None] * dst).sum(0)
    a, b = src - ms, dst - md
    C = (w[:, None, None] * b[:, :, None] * a[:, None, :]).sum(0)
    U, S, Vt = np.linalg.svd(C)
    D = np.eye(3)
    D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (w * (a * a).sum(1)).sum()
    return s, R, md - s * R @ ms


def yup2z(V):
    """glTF Y-up (front +z) -> Blender Z-up (front -y)."""
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)


def skin_weights(rd, n, nb):
    JN = rd("body_joints.bin", np.uint16, 4).astype(np.int64)
    WT = rd("body_weights.bin", np.float32, 4).astype(np.float64)
    W = np.zeros((n, nb))
    np.add.at(W, (np.repeat(np.arange(n), 4), JN.ravel()), WT.ravel())
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    return W


def posed_skin(ROT, JP, PAR, W):
    """Per-vertex skin matrices of the fitted pose: each bone's rotation about its rest joint, down the hierarchy."""
    nb = len(PAR)
    A = np.zeros((nb, 4, 4))
    for b in range(nb):
        T = np.eye(4)
        T[:3, :3] = ROT[b]
        T[:3, 3] = JP[b] - ROT[b] @ JP[b]
        A[b] = A[PAR[b]] @ T if PAR[b] >= 0 else T
    return (W @ A.reshape(nb, 16)).reshape(-1, 4, 4)
