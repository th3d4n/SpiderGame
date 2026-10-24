"""Build multi-take sound sprites for the game.

Each output sound packs several takes into ONE file (takes separated by
silence) so the browser makes one request per sound, then the engine cuts
it back into takes using the table this writes to
src/systems/audioSprites.ts.

    python tools/audio/build_sprites.py            # build everything in SPEC
    python tools/audio/build_sprites.py ant_click  # just these keys
    python tools/audio/build_sprites.py --hash-only   # after replacing any audio file by hand

Sources come from the local library (LIB below — the Freesound / Kenney /
Sonniss downloads from the first audio pass).  Takes are found by an energy
gate: a take starts where the 10 ms RMS rises above `gate` dB (relative to
the loudest window in the source) and ends after it stays below for
`hold` s.  Pure Python + the ffmpeg in the library's Tools folder.
"""
import array, glob, hashlib, json, math, os, subprocess, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
LIB = r'D:\dmorgan\Downloads\nolegsAudio'
FFMPEG = os.path.join(LIB, 'Tools', 'bin', 'ffmpeg.exe')
OUT_AUDIO = os.path.join(REPO, 'public', 'audio')
OUT_TS = os.path.join(REPO, 'src', 'systems', 'audioSprites.ts')
WORK = os.path.join(HERE, '.work')
SR = 48000
GAP = 0.3   # silence between takes in the sprite (cut points sit mid-gap)

sys.path.insert(0, HERE)
from sprite_spec import SPEC  # noqa: E402


def resolve(rel):
    """Library path → real file (the spec can drop or guess the extension)."""
    full = os.path.join(LIB, rel)
    if os.path.exists(full):
        return full
    base = glob.escape(os.path.splitext(full)[0])
    for pat in (base + '.*', base + '*'):   # other extension, or a name cut short
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    raise SystemExit(f'missing source: {rel}')


def decode(path, start=0.0, dur=None, af=None):
    """Source → mono float PCM at SR (optionally a window of it, with filters)."""
    cmd = [FFMPEG, '-v', 'error', '-ss', str(start)]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-i', path, '-ac', '1', '-ar', str(SR)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = array.array('f')
    a.frombytes(raw[: len(raw) // 4 * 4])
    return a


def segments(x, gate=-34.0, hold=0.08, min_len=0.04, max_len=None, pre=0.012, tail=0.05):
    win = int(SR * 0.01)
    n = len(x) // win
    if n == 0:
        return []
    env = []
    for i in range(n):
        s = 0.0
        for v in x[i * win:(i + 1) * win]:
            s += v * v
        env.append(math.sqrt(s / win) + 1e-9)
    peak = max(env)
    thr = peak * 10 ** (gate / 20)
    segs, on, start, quiet = [], False, 0, 0
    hold_w = max(1, int(hold / 0.01))
    for i, e in enumerate(env):
        if not on and e >= thr:
            on, start, quiet = True, i, 0
        elif on:
            quiet = quiet + 1 if e < thr else 0
            if quiet >= hold_w:
                segs.append((start, i - quiet + 1)); on = False
    if on:
        segs.append((start, n))
    out = []
    for a, b in segs:
        t0 = max(0.0, a * 0.01 - pre)
        t1 = min(len(x) / SR, b * 0.01 + tail)
        L = t1 - t0
        if L < min_len:
            continue
        if max_len and L > max_len:
            t1 = t0 + max_len
        # loudness of the take (for ranking)
        seg_env = env[a:b] or [1e-9]
        loud = 20 * math.log10(max(seg_env) / peak)
        out.append((t0, t1, loud))
    return out


def cut(x, t0, t1, fade_in=0.004, fade_out=0.03):
    a = array.array('f', x[int(t0 * SR):int(t1 * SR)])
    n = len(a)
    fi, fo = int(fade_in * SR), min(int(fade_out * SR), n // 2)
    for i in range(min(fi, n)):
        a[i] *= i / fi
    for i in range(fo):
        a[n - 1 - i] *= i / fo
    return a


def pick(segs, want, how):
    if how == 'loudest':
        segs = sorted(segs, key=lambda s: -s[2])[:want]
        return sorted(segs, key=lambda s: s[0])
    if want >= len(segs):
        return segs
    # spread through the recording — performers vary over a session
    step = len(segs) / want
    return [segs[int(i * step)] for i in range(want)]


def build(key, spec):
    takes = []
    for src in spec['src']:
        path = resolve(src['file'])
        x = decode(path, src.get('start', 0.0), src.get('dur'), src.get('af'))
        if src.get('whole'):
            t = x
            if src.get('max_len'):
                t = cut(x, 0, min(len(x) / SR, src['max_len']))
            takes.append(array.array('f', t))
            continue
        segs = segments(x, src.get('gate', -34.0), src.get('hold', 0.08), src.get('min_len', 0.04),
                        src.get('max_len'), src.get('pre', 0.012), src.get('tail', 0.05))
        segs = [s for s in segs if s[2] >= src.get('min_loud', -24.0)]
        for t0, t1, _ in pick(segs, src.get('n', 6), src.get('how', 'spread')):
            takes.append(cut(x, t0, t1, fade_out=src.get('fade', 0.03)))
    if not takes:
        raise SystemExit(f'{key}: no takes found')
    # Peak-normalise each take to the same level (the engine RMS-normalises
    # per take too; this just keeps the encoder away from clipping/noise floor)
    gap = array.array('f', [0.0]) * int(GAP * SR)
    sprite, bounds, t = array.array('f'), [], 0.0
    for tk in takes:
        pk = max(1e-6, max(abs(v) for v in tk))
        g = 0.89 / pk
        for i in range(len(tk)):
            tk[i] *= g
        if sprite:
            sprite.extend(gap[: len(gap) // 2])
            t += len(gap) // 2 / SR
            bounds.append(round(t, 4))
            sprite.extend(gap[len(gap) // 2:])
            t += (len(gap) - len(gap) // 2) / SR
        sprite.extend(tk)
        t += len(tk) / SR
    os.makedirs(WORK, exist_ok=True)
    wav = os.path.join(WORK, key + '.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(array.array('h', (int(max(-1, min(1, v)) * 32767) for v in sprite)).tobytes())
    br = spec.get('kbps', 64)
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', wav, '-c:a', 'libopus', '-b:a', f'{br}k', '-application', 'audio',
                    os.path.join(OUT_AUDIO, key + '.webm')], check=True)
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', f'{max(96, br + 32)}k',
                    os.path.join(OUT_AUDIO, key + '.mp3')], check=True)
    return {'takes': len(takes), 'cuts': bounds, 'dur': round(t, 3),
            'lens': [round(len(tk) / SR, 3) for tk in takes]}


def audio_hashes():
    """Short content hash per sound (webm + mp3 together).  The engine puts it in
    the URL, so a changed file gets a new URL and no browser or Cloudflare edge
    can keep serving the old one (/audio/* is cached for a day, stale for a week)."""
    by_name = {}
    for f in sorted(os.listdir(OUT_AUDIO)):
        name, ext = os.path.splitext(f)
        if ext not in ('.webm', '.mp3'):
            continue
        by_name.setdefault(name, hashlib.md5()).update(open(os.path.join(OUT_AUDIO, f), 'rb').read())
    return {k: h.hexdigest()[:8] for k, h in by_name.items()}


def write_ts(table):
    lines = [
        '// GENERATED by tools/audio/build_sprites.py — do not edit by hand.',
        '// Rerun it (or `--hash-only`) after changing ANY file in public/audio.',
        '',
        '// Multi-take sound files: each file packs several takes separated by',
        '// silence; the numbers are the split points (s) between consecutive takes.',
        'export const AUDIO_SPRITES: Record<string, number[]> = {',
    ]
    for k in sorted(table):
        lines.append(f"  {k}: [{', '.join(str(c) for c in table[k]['cuts'])}],   // {table[k]['takes']} takes")
    lines.append('}')
    lines += ['', '// Content hash per file, appended to its URL as ?v= (cache busting)',
              'export const AUDIO_HASH: Record<string, string> = {']
    for k, h in audio_hashes().items():
        lines.append(f"  {k}: '{h}',")
    lines.append('}')
    open(OUT_TS, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')


def main():
    hash_only = '--hash-only' in sys.argv
    only = set(a for a in sys.argv[1:] if not a.startswith('--'))
    manifest_path = os.path.join(HERE, 'sprites.json')
    table = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for key, spec in SPEC.items():
        if hash_only or (only and key not in only):
            continue
        info = build(key, spec)
        table[key] = info
        print(f"{key:24s} {info['takes']:2d} takes  {info['dur']:6.2f}s  lens={info['lens']}")
    # drop keys no longer in the spec
    table = {k: v for k, v in table.items() if k in SPEC}
    json.dump(table, open(manifest_path, 'w'), indent=1)
    write_ts(table)


if __name__ == '__main__':
    main()
