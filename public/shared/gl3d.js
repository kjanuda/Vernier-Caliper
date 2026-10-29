/* MechSimulator shared WebGL kit — pure maths, mesh builders, camera, tiers.
   No tool knowledge. Loaded before a tool's 3D module.
   Maths and builders are moved verbatim from tools/four-stroke-engine/engine3d.js. */
(function() {
    'use strict';
    var GL3D_VER = 3;
    var PI = Math.PI,
        TAU = 2 * PI,
        D2R = PI / 180;

    /* ── 1. Small vector / matrix kit (column-major, as WebGL wants) ── */
    function M4() {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }

    function mul(a, b) {
        var o = new Float32Array(16);
        for (var c = 0; c < 4; c++)
            for (var r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
            }
        return o;
    }

    function chain() {
        var m = arguments[0];
        for (var i = 1; i < arguments.length; i++) m = mul(m, arguments[i]);
        return m;
    }

    function T(x, y, z) {
        var m = M4();
        m[12] = x;
        m[13] = y;
        m[14] = z;
        return m;
    }

    function Sc(x, y, z) {
        var m = M4();
        m[0] = x;
        m[5] = y;
        m[10] = z;
        return m;
    }

    function RX(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = M4();
        m[5] = c;
        m[6] = s;
        m[9] = -s;
        m[10] = c;
        return m;
    }

    function RY(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = M4();
        m[0] = c;
        m[2] = -s;
        m[8] = s;
        m[10] = c;
        return m;
    }

    function RZ(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = M4();
        m[0] = c;
        m[1] = s;
        m[4] = -s;
        m[5] = c;
        return m;
    }

    function persp(fov, asp, n, f) {
        var t = 1 / Math.tan(fov / 2),
            m = new Float32Array(16);
        m[0] = t / asp;
        m[5] = t;
        m[10] = (f + n) / (n - f);
        m[11] = -1;
        m[14] = 2 * f * n / (n - f);
        return m;
    }

    function ortho(l, r, b, t, n, f) {
        var m = M4();
        m[0] = 2 / (r - l);
        m[5] = 2 / (t - b);
        m[10] = -2 / (f - n);
        m[12] = -(r + l) / (r - l);
        m[13] = -(t + b) / (t - b);
        m[14] = -(f + n) / (f - n);
        return m;
    }

    function sub(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    function add(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    function scl(a, k) {
        return [a[0] * k, a[1] * k, a[2] * k];
    }

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    function len(a) {
        return Math.sqrt(dot(a, a));
    }

    function nrm(a) {
        var l = len(a) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
    }

    function lookAt(e, c, up) {
        var z = nrm(sub(e, c)),
            x = nrm(cross(up, z)),
            y = cross(z, x),
            m = M4();
        m[0] = x[0];
        m[4] = x[1];
        m[8] = x[2];
        m[1] = y[0];
        m[5] = y[1];
        m[9] = y[2];
        m[2] = z[0];
        m[6] = z[1];
        m[10] = z[2];
        m[12] = -dot(x, e);
        m[13] = -dot(y, e);
        m[14] = -dot(z, e);
        return m;
    }

    function xf(m, p) {
        return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
        ];
    }

    function xfv(m, p) {
        return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2]
        ];
    }

    function xf4(m, p) {
        return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
            m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
        ];
    }

    function clamp(v, a, b) {
        return v < a ? a : v > b ? b : v;
    }

    function smooth(e0, e1, x) {
        var t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    function mod(a, n) {
        return ((a % n) + n) % n;
    }

    /* ── 2. Geometry builder ───────────────────────────────────────────
       Normals point OUT of the material. Winding is not relied on: the
       shader tells a back face from a front face by comparing the vertex
       normal with the true facet normal. */
    function Geo() {
        this.p = [];
        this.n = [];
        this.u = [];
        this.i = [];
    }
    Geo.prototype.v = function(x, y, z, nx, ny, nz, u, w) {
        this.p.push(x, y, z);
        this.n.push(nx, ny, nz);
        this.u.push(u || 0, w || 0);
        return this.p.length / 3 - 1;
    };
    Geo.prototype.tri = function(a, b, c) {
        this.i.push(a, b, c);
    };
    Geo.prototype.quad = function(a, b, c, d) {
        this.i.push(a, b, c, a, c, d);
    };
    Geo.prototype.mark = function() {
        return this.p.length / 3;
    };
    Geo.prototype.xform = function(from, m) {
        for (var k = from; k < this.p.length / 3; k++) {
            var q = xf(m, [this.p[3 * k], this.p[3 * k + 1], this.p[3 * k + 2]]);
            var n = nrm(xfv(m, [this.n[3 * k], this.n[3 * k + 1], this.n[3 * k + 2]]));
            this.p[3 * k] = q[0];
            this.p[3 * k + 1] = q[1];
            this.p[3 * k + 2] = q[2];
            this.n[3 * k] = n[0];
            this.n[3 * k + 1] = n[1];
            this.n[3 * k + 2] = n[2];
        }
        return this;
    };

    /* Surface of revolution about +Y. prof = [[r, y], ...] traversed
       counter-clockwise in the (r, y) plane, so (dy, -dr) is outward. */
    function lathe(g, prof, seg, smoothDeg, a0, a1) {
        seg = seg || 48;
        a0 = a0 || 0;
        a1 = (a1 == null) ? TAU : a1;
        var cosT = Math.cos((smoothDeg == null ? 40 : smoothDeg) * D2R),
            ns = [],
            i, k;
        for (i = 0; i < prof.length - 1; i++) {
            var dr = prof[i + 1][0] - prof[i][0],
                dy = prof[i + 1][1] - prof[i][1],
                l = Math.hypot(dr, dy) || 1;
            ns.push([dy / l, -dr / l]);
        }
        for (var s = 0; s < ns.length; s++) {
            var A = prof[s],
                B = prof[s + 1],
                n = ns[s],
                nA = n,
                nB = n;
            if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-9) continue;
            if (s > 0 && ns[s - 1][0] * n[0] + ns[s - 1][1] * n[1] > cosT) nA = n2(ns[s - 1], n);
            if (s < ns.length - 1 && ns[s + 1][0] * n[0] + ns[s + 1][1] * n[1] > cosT) nB = n2(ns[s + 1], n);
            var base = g.mark();
            for (k = 0; k <= seg; k++) {
                var t = a0 + (a1 - a0) * k / seg,
                    c = Math.cos(t),
                    sn = Math.sin(t);
                g.v(A[0] * c, A[1], A[0] * sn, nA[0] * c, nA[1], nA[0] * sn, k / seg, A[1]);
                g.v(B[0] * c, B[1], B[0] * sn, nB[0] * c, nB[1], nB[0] * sn, k / seg, B[1]);
            }
            for (k = 0; k < seg; k++) {
                var q = base + 2 * k;
                g.quad(q, q + 2, q + 3, q + 1);
            }
        }

        function n2(a, b) {
            var x = a[0] + b[0],
                y = a[1] + b[1],
                l = Math.hypot(x, y) || 1;
            return [x / l, y / l];
        }
    }
    /* A closed solid cylinder along +Y, radius r, y0..y1. */
    function rod(g, r, y0, y1, seg) {
        lathe(g, [
            [0, y0],
            [r, y0],
            [r, y1],
            [0, y1]
        ], seg || 32);
    }

    /* Extrude a closed outline in the XY plane between z0 and z1. The
       outline must be star-shaped about (cx, cy): the caps are fans. */
    function extrude(g, poly, z0, z1, cx, cy, smoothDeg) {
        var n = poly.length,
            i, area = 0;
        for (i = 0; i < n; i++) {
            var a = poly[i],
                b = poly[(i + 1) % n];
            area += a[0] * b[1] - b[0] * a[1];
        }
        if (area < 0) poly = poly.slice().reverse();
        var en = [];
        for (i = 0; i < n; i++) {
            var p = poly[i],
                q = poly[(i + 1) % n],
                dx = q[0] - p[0],
                dy = q[1] - p[1],
                l = Math.hypot(dx, dy) || 1;
            en.push([dy / l, -dx / l]);
        }
        var cosT = Math.cos((smoothDeg == null ? 32 : smoothDeg) * D2R),
            U = 0;
        for (i = 0; i < n; i++) {
            var P = poly[i],
                Q = poly[(i + 1) % n],
                e = en[i],
                ep = en[(i - 1 + n) % n],
                enx = en[(i + 1) % n];
            var nP = (e[0] * ep[0] + e[1] * ep[1] > cosT) ? h2(e, ep) : e;
            var nQ = (e[0] * enx[0] + e[1] * enx[1] > cosT) ? h2(e, enx) : e;
            var L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
            var v0 = g.v(P[0], P[1], z0, nP[0], nP[1], 0, U, 0),
                v1 = g.v(Q[0], Q[1], z0, nQ[0], nQ[1], 0, U + L, 0);
            var v2 = g.v(Q[0], Q[1], z1, nQ[0], nQ[1], 0, U + L, 1),
                v3 = g.v(P[0], P[1], z1, nP[0], nP[1], 0, U, 1);
            g.quad(v0, v1, v2, v3);
            U += L;
        }
        [
            [z0, -1],
            [z1, 1]
        ].forEach(function(cap) {
            var c = g.v(cx, cy, cap[0], 0, 0, cap[1]),
                first = g.mark();
            for (var j = 0; j < n; j++) g.v(poly[j][0], poly[j][1], cap[0], 0, 0, cap[1]);
            for (j = 0; j < n; j++) g.tri(c, first + j, first + (j + 1) % n);
        });

        function h2(a, b) {
            var x = a[0] + b[0],
                y = a[1] + b[1],
                l = Math.hypot(x, y) || 1;
            return [x / l, y / l];
        }
    }
    /* Axis-aligned box. inward = the box is a cavity (normals point in). */
    function box(g, x0, x1, y0, y1, z0, z1, inward) {
        var s = inward ? -1 : 1;
        face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, s]);
        face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -s]);
        face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [s, 0, 0]);
        face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-s, 0, 0]);
        face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, s, 0]);
        face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -s, 0]);

        function face(a, b, c, d, n) {
            var i0 = g.v(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0),
                i1 = g.v(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0);
            var i2 = g.v(c[0], c[1], c[2], n[0], n[1], n[2], 1, 1),
                i3 = g.v(d[0], d[1], d[2], n[0], n[1], n[2], 0, 1);
            g.quad(i0, i1, i2, i3);
        }
    }

    function cylWall(g, R, y0, y1, inward, seg) {
        seg = seg || 64;
        var s = inward ? -1 : 1,
            base = g.mark();
        for (var k = 0; k <= seg; k++) {
            var t = k / seg * TAU,
                c = Math.cos(t),
                sn = Math.sin(t);
            g.v(R * c, y0, R * sn, s * c, 0, s * sn, k / seg, 0);
            g.v(R * c, y1, R * sn, s * c, 0, s * sn, k / seg, 1);
        }
        for (k = 0; k < seg; k++) {
            var q = base + 2 * k;
            g.quad(q, q + 2, q + 3, q + 1);
        }
    }

    function annulus(g, r0, r1, y, ny, seg) {
        seg = seg || 64;
        var base = g.mark();
        for (var k = 0; k <= seg; k++) {
            var t = k / seg * TAU,
                c = Math.cos(t),
                s = Math.sin(t);
            g.v(r0 * c, y, r0 * s, 0, ny, 0);
            g.v(r1 * c, y, r1 * s, 0, ny, 0);
        }
        for (k = 0; k < seg; k++) {
            var q = base + 2 * k;
            g.quad(q, q + 2, q + 3, q + 1);
        }
    }
    /* A tube swept along a polyline with parallel-transport frames.
       rad(t) gives the radius at t in 0..1. u carries the arc length, so a
       shader can run a pattern along the tube. */
    function tube(g, pts, rad, seg, inward, closed) {
        var n = pts.length,
            Tg = [],
            i, k;
        for (i = 0; i < n; i++) {
            var a = pts[closed ? mod(i - 1, n) : Math.max(0, i - 1)],
                b = pts[closed ? mod(i + 1, n) : Math.min(n - 1, i + 1)];
            Tg.push(nrm(sub(b, a)));
        }
        var ref = Math.abs(Tg[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        var N = nrm(cross(cross(Tg[0], ref), Tg[0])),
            s = inward ? -1 : 1,
            base = g.mark(),
            U = 0;
        for (i = 0; i < n; i++) {
            if (i > 0) {
                N = nrm(sub(N, scl(Tg[i], dot(N, Tg[i]))));
                U += len(sub(pts[i], pts[i - 1]));
            }
            var Bn = cross(Tg[i], N),
                r = rad(i / (n - 1));
            for (k = 0; k <= seg; k++) {
                var t = k / seg * TAU,
                    d = add(scl(N, Math.cos(t)), scl(Bn, Math.sin(t))),
                    p = add(pts[i], scl(d, r));
                g.v(p[0], p[1], p[2], s * d[0], s * d[1], s * d[2], U, k / seg);
            }
        }
        var rows = closed ? n : n - 1;
        for (i = 0; i < rows; i++)
            for (k = 0; k < seg; k++) {
                var a0 = base + i * (seg + 1) + k,
                    a1 = base + ((i + 1) % n) * (seg + 1) + k;
                g.quad(a0, a0 + 1, a1 + 1, a1);
            }
        return U;
    }

    /* Helix of round wire about +Y: centre radius rc, wire radius rw,
       `turns` turns, `seg` segments per turn, axial advance `pitch` per turn.
       Returns the pitch and length actually built, so a caller (and the gate)
       can assert the drawn thread is the instrument's. */
    function helix(g, rc, rw, turns, seg, pitch) {
        var n = Math.max(2, Math.round(turns * seg)),
            pts = [];
        for (var k = 0; k <= n; k++) {
            var a = 2 * Math.PI * k / seg;
            pts.push([rc * Math.cos(a), pitch * k / seg, rc * Math.sin(a)]);
        }
        tube(g, pts, function() {
            return rw;
        }, 10, false, false);
        return {
            pitch: pitch,
            length: pitch * n / seg
        };
    }

    function orbitEye(c, yaw, pitch, dist) {
        var cp = Math.cos(pitch);
        return [c[0] + dist * cp * Math.sin(yaw), c[1] + dist * Math.sin(pitch), c[2] + dist * cp * Math.cos(yaw)];
    }

    function clampDt(ms) {
        return ms > 0 ? (ms < 50 ? ms : 50) : 0;
    }

    var TIERS = {
        full: {
            shadows: true,
            dprMax: 2,
            knurlSeg: 96,
            threadSeg: 48,
            cutShade: true
        },
        lite: {
            shadows: false,
            dprMax: 1.5,
            knurlSeg: 48,
            threadSeg: 24,
            cutShade: true
        },
        minimal: {
            shadows: false,
            dprMax: 1,
            knurlSeg: 32,
            threadSeg: 16,
            cutShade: false
        }
    };
    var ORDER = ['full', 'lite', 'minimal'];

    /* caps: { w: CSS px viewport width, coarse: pointer is coarse,
               maxTex: MAX_TEXTURE_SIZE, renderer: UNMASKED_RENDERER or '' } */
    function pickTier(c) {
        var r = String(c.renderer || '').toLowerCase();
        if (/swiftshader|llvmpipe|software|microsoft basic/.test(r)) return 'minimal';
        if (c.maxTex && c.maxTex <= 4096) return 'minimal';
        if (/adreno \(tm\) [1-5]\d\d|mali-[t4]|powervr/.test(r)) return 'minimal';
        if (c.coarse || c.w < 768) return 'lite';
        return 'full';
    }

    /* Measures ~2 s of frames, then steps DOWN once if p95 exceeds the budget.
       Never steps up, so the picture cannot flicker between qualities. */
    function makeGovernor(tier, budgetMs) {
        var buf = [],
            cur = tier,
            done = false;
        return {
            sample: function(dt) {
                if (done) return cur;
                buf.push(clampDt(dt));
                if (buf.length < 120) return cur;
                var s = buf.slice().sort(function(a, b) {
                    return a - b;
                });
                var p95 = s[Math.floor(0.95 * (s.length - 1))];
                if (p95 > budgetMs) {
                    var i = ORDER.indexOf(cur);
                    if (i < ORDER.length - 1) cur = ORDER[i + 1];
                }
                done = true;
                return cur;
            }
        };
    }

    /* ── 4b. The CAD view cube. A small orthographic cube in a corner of the overlay that turns with the
       orbit camera (eye at orbitEye(target, yaw, pitch, dist), up = +y). World axes name its faces:
       +z FRONT, −z BACK, +x RIGHT, −x LEFT, +y TOP, −y BOTTOM. Each face is split 3 × 3, so the cube offers
       26 directions: 6 faces, 12 edges, 8 corners, each a vector in {−1, 0, 1}³. Pure except draw(),
       which only paints a 2D context it is handed. ── */
    var VC = {
        PITCH_MAX: 1.55, // ≈ 88.8°: TOP/BOTTOM look (almost) straight down/up; at exactly 90° the up vector is lost
        EDGE: 0.62, // a face coordinate beyond ±EDGE (face half-side 1) is in an edge or corner band
        HALF: 26, // CSS px from the cube's centre to a face
        BOX: 96, // CSS px square the cube is drawn in
        HOME: 22, // CSS px side of the home button, to the box's left
        MIN_W: 760 // narrower than this (CSS px viewport) there is no cube
    };
    // n: face normal; u, v: the face's text right / text up, so a label reads upright seen head-on.
    var VC_FACES = [{
            n: [0, 0, 1],
            u: [1, 0, 0],
            v: [0, 1, 0],
            label: 'FRONT'
        },
        {
            n: [0, 0, -1],
            u: [-1, 0, 0],
            v: [0, 1, 0],
            label: 'BACK'
        },
        {
            n: [1, 0, 0],
            u: [0, 0, -1],
            v: [0, 1, 0],
            label: 'RIGHT'
        },
        {
            n: [-1, 0, 0],
            u: [0, 0, 1],
            v: [0, 1, 0],
            label: 'LEFT'
        },
        {
            n: [0, 1, 0],
            u: [1, 0, 0],
            v: [0, 0, -1],
            label: 'TOP'
        },
        {
            n: [0, -1, 0],
            u: [1, 0, 0],
            v: [0, 0, 1],
            label: 'BOTTOM'
        }
    ];
    // The camera's screen axes for a yaw/pitch, as the scene's lookAt builds them.
    function vcBasis(yaw, pitch) {
        var z = orbitEye([0, 0, 0], yaw, pitch, 1),
            x = nrm(cross([0, 1, 0], z)),
            y = cross(z, x);
        return {
            x: x,
            y: y,
            z: z
        };
    }
    // Where the cube sits: top-right of a W × H CSS-px overlay, its box top at `top`.
    function vcLayout(W, H, top) {
        var t = top == null ? 8 : top,
            bx = W - 8 - VC.BOX;
        return {
            box: {
                x: bx,
                y: t,
                w: VC.BOX,
                h: VC.BOX
            },
            cx: bx + VC.BOX / 2,
            cy: t + VC.BOX / 2,
            s: VC.HALF,
            home: {
                x: bx - VC.HOME - 4,
                y: t + 4,
                w: VC.HOME,
                h: VC.HOME
            }
        };
    }

    function vcScreen(B, L, p) {
        return [L.cx + L.s * dot(B.x, p), L.cy - L.s * dot(B.y, p)];
    }
    // Desktop only: a fine, hovering pointer and a wide enough window.
    function vcWanted(win) {
        if (!win) return false;
        var mm = win.matchMedia ? win.matchMedia('(hover: hover) and (pointer: fine)') : null;
        return !!(mm && mm.matches) && (win.innerWidth || 0) >= VC.MIN_W;
    }
    /* What is under CSS point (px, py): {kind:'home'}, {kind:'cube', d:[dx,dy,dz], face:i} or null.
       Orthographic ray cast: the screen point is a·x + b·y + t·z; it meets face n·p = 1 at
       t = (1 − n·(a x + b y)) / (n·z), and the front-most hit (largest t) inside the face wins. */
    function vcHit(px, py, yaw, pitch, L) {
        var h = L.home;
        if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return {
            kind: 'home'
        };
        var B = vcBasis(yaw, pitch),
            a = (px - L.cx) / L.s,
            b = -(py - L.cy) / L.s,
            best = null;
        for (var i = 0; i < 6; i++) {
            var f = VC_FACES[i],
                nz = dot(f.n, B.z);
            if (nz <= 1e-6) continue; // facing away: never visible, never hit
            var q = add(scl(B.x, a), scl(B.y, b)),
                t = (1 - dot(f.n, q)) / nz,
                p = add(q, scl(B.z, t));
            var inside = true;
            for (var k = 0; k < 3; k++)
                if (!f.n[k] && Math.abs(p[k]) > 1 + 1e-9) inside = false;
            if (inside && (!best || t > best.t)) best = {
                t: t,
                p: p,
                i: i
            };
        }
        if (!best) return null;
        var f2 = VC_FACES[best.i],
            d = [0, 0, 0];
        for (var j = 0; j < 3; j++) d[j] = f2.n[j] ? f2.n[j] : (best.p[j] > VC.EDGE ? 1 : best.p[j] < -VC.EDGE ? -1 : 0);
        return {
            kind: 'cube',
            d: d,
            face: best.i
        };
    }
    // The camera that looks along a cube direction: the eye sits out along d. Straight up/down keeps yaw 0,
    // so FRONT is at the bottom of TOP — as a drawing's plan sits under its elevation.
    function vcViewFor(d) {
        var n = nrm(d),
            yaw = (Math.abs(n[0]) < 1e-12 && Math.abs(n[2]) < 1e-12) ? 0 : Math.atan2(n[0], n[2]);
        return {
            yaw: yaw,
            pitch: clamp(Math.asin(clamp(n[1], -1, 1)), -VC.PITCH_MAX, VC.PITCH_MAX)
        };
    }
    // The patch of face i that belongs to direction d, as four corner points (or null if d is not on it).
    function vcPatch(i, d) {
        var f = VC_FACES[i],
            ax = f.n[0] ? 0 : f.n[1] ? 1 : 2;
        if (d[ax] !== f.n[ax]) return null;
        var lo = [],
            hi = [];
        for (var k = 0; k < 3; k++) {
            if (k === ax) {
                lo[k] = hi[k] = f.n[ax];
                continue;
            }
            lo[k] = d[k] === 1 ? VC.EDGE : d[k] === -1 ? -1 : -VC.EDGE;
            hi[k] = d[k] === 1 ? 1 : d[k] === -1 ? -VC.EDGE : VC.EDGE;
        }
        var o = [0, 1, 2].filter(function(k) {
                return k !== ax;
            }),
            A = o[0],
            C = o[1];

        function P(ua, uc) {
            var p = [0, 0, 0];
            p[ax] = f.n[ax];
            p[A] = ua;
            p[C] = uc;
            return p;
        }
        return [P(lo[A], lo[C]), P(hi[A], lo[C]), P(hi[A], hi[C]), P(lo[A], hi[C])];
    }
    // The whole face i as four corners, n ± u ± v (the patch for d = n is only its middle ninth).
    function vcQuad(i) {
        var f = VC_FACES[i];
        return [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1]
        ].map(function(c) {
            return add(f.n, add(scl(f.u, c[0]), scl(f.v, c[1])));
        });
    }
    /* Paints the cube on a 2D context whose backing store is k × CSS px. hover: a vcHit result or null.
       Returns the drawn faces (index, screen polygon, depth) so a gate can read the picture back. */
    function vcDraw(ctx, k, yaw, pitch, L, hover) {
        var B = vcBasis(yaw, pitch),
            faces = [];
        VC_FACES.forEach(function(f, i) {
            var nz = dot(f.n, B.z);
            if (nz <= 1e-6) return;
            faces.push({
                i: i,
                nz: nz,
                poly: vcQuad(i).map(function(p) {
                    return vcScreen(B, L, p);
                })
            });
        });
        faces.sort(function(a, b) {
            return a.nz - b.nz;
        });
        ctx.save();

        function path(poly) {
            ctx.beginPath();
            poly.forEach(function(q, j) {
                ctx[j ? 'lineTo' : 'moveTo'](q[0] * k, q[1] * k);
            });
            ctx.closePath();
        }
        faces.forEach(function(F) {
            var f = VC_FACES[F.i],
                lit = 0.55 + 0.45 * F.nz;
            path(F.poly);
            ctx.fillStyle = 'rgba(' + Math.round(38 * lit + 20) + ',' + Math.round(50 * lit + 22) + ',' + Math.round(72 * lit + 26) + ',0.94)';
            ctx.fill();
            if (hover && hover.kind === 'cube') {
                var pat = vcPatch(F.i, hover.d);
                if (pat) {
                    path(pat.map(function(p) {
                        return vcScreen(B, L, p);
                    }));
                    ctx.fillStyle = 'rgba(79,142,247,0.78)';
                    ctx.fill();
                }
            }
            path(F.poly);
            ctx.strokeStyle = 'rgba(170,190,220,0.75)';
            ctx.lineWidth = 1 * k;
            ctx.stroke();
            // the label, laid in the face's own plane (foreshortened with it); 24 label px per face half-side
            var o = vcScreen(B, L, f.n),
                m = L.s / 24;
            var U = [dot(B.x, f.u) * m, -dot(B.y, f.u) * m],
                V = [-dot(B.x, f.v) * m, dot(B.y, f.v) * m];
            if (F.nz > 0.12) {
                ctx.save();
                ctx.setTransform(U[0] * k, U[1] * k, V[0] * k, V[1] * k, o[0] * k, o[1] * k);
                ctx.font = "bold 10px 'Segoe UI', system-ui, sans-serif";
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var tw = ctx.measureText(f.label).width;
                if (tw > 42) ctx.font = 'bold ' + (10 * 42 / tw).toFixed(2) + "px 'Segoe UI', system-ui, sans-serif";
                ctx.fillStyle = 'rgba(225,234,248,' + Math.min(1, 0.35 + F.nz) + ')';
                ctx.fillText(f.label, 0, 0.5);
                ctx.restore();
            }
        });
        // the home button: a small house
        var h = L.home,
            hv = hover && hover.kind === 'home';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(h.x * k, h.y * k, h.w * k, h.h * k, 5 * k);
        else ctx.rect(h.x * k, h.y * k, h.w * k, h.h * k);
        ctx.fillStyle = hv ? 'rgba(79,142,247,0.9)' : 'rgba(10,16,24,0.82)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,190,220,0.6)';
        ctx.lineWidth = 1 * k;
        ctx.stroke();
        var X = h.x + h.w / 2,
            Y = h.y + h.h / 2;
        ctx.beginPath();
        ctx.moveTo((X - 6) * k, (Y) * k);
        ctx.lineTo(X * k, (Y - 6) * k);
        ctx.lineTo((X + 6) * k, Y * k);
        ctx.moveTo((X - 4) * k, (Y - 1) * k);
        ctx.lineTo((X - 4) * k, (Y + 6) * k);
        ctx.lineTo((X + 4) * k, (Y + 6) * k);
        ctx.lineTo((X + 4) * k, (Y - 1) * k);
        ctx.strokeStyle = '#e8f1ff';
        ctx.lineWidth = 1.6 * k;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
        return faces;
    }
    var viewCube = {
        VC: VC,
        FACES: VC_FACES,
        basis: vcBasis,
        layout: vcLayout,
        wanted: vcWanted,
        hit: vcHit,
        viewFor: vcViewFor,
        patch: vcPatch,
        quad: vcQuad,
        screen: vcScreen,
        draw: vcDraw
    };

    /* ── 5. The GL runtime. Touches window/document only when called. ── */
    var STD_VS = [
        'attribute vec3 aP; attribute vec3 aN; attribute vec2 aU;',
        'uniform mat4 uMVP; uniform mat4 uM; uniform mat4 uNM; uniform mat4 uShadowVP;',
        'varying vec3 vPos; varying vec3 vN; varying vec2 vU; varying vec4 vL;',
        'void main(){ vec4 w = uM*vec4(aP,1.0); vPos = w.xyz;',
        ' vN = mat3(uNM[0].xyz, uNM[1].xyz, uNM[2].xyz)*aN; vU = aU; vL = uShadowVP*w; gl_Position = uMVP*vec4(aP,1.0); }'
    ].join('\n');
    var STD_FS = [
        '#extension GL_OES_standard_derivatives : enable',
        'precision highp float;',
        'varying vec3 vPos; varying vec3 vN; varying vec2 vU; varying vec4 vL;',
        'uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uCol; uniform float uRough; uniform float uMetal;',
        'uniform vec3 uCutN; uniform float uCutD; uniform bool uCutOn; uniform vec3 uCutCol;',
        'uniform sampler2D uShadow; uniform mat4 uShadowVP; uniform bool uShadowOn; uniform float uShadowTexel;',
        'uniform bool uIdOn; uniform vec3 uId;',
        'uniform bool uTexOn; uniform sampler2D uTex;',
        'float unpack(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }',
        'float shadowAt(vec3 N){',
        ' vec3 p = vL.xyz/vL.w*0.5+0.5;',
        ' if (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;',
        ' float bias = 0.0008 + 0.0025*(1.0-abs(dot(N,uLight)));',
        ' float s = 0.0;',
        ' for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++){',
        '  float d = unpack(texture2D(uShadow, p.xy+vec2(float(i),float(j))*uShadowTexel));',
        '  s += (p.z - bias > d) ? 0.0 : 1.0; }',
        ' return s/9.0; }',
        'vec3 envMap(vec3 d, float rough){',
        ' float y = d.y;',
        ' vec3 sky = mix(vec3(0.16,0.17,0.20), vec3(0.55,0.58,0.64), smoothstep(-0.1,0.9,y));',
        ' vec3 c = y > 0.0 ? sky : mix(vec3(0.10,0.10,0.11), vec3(0.05,0.045,0.04), smoothstep(0.0,-0.5,y));',
        ' float w = 1.0 - rough*0.75;',
        ' float s1 = smoothstep(0.80-rough*0.5, 0.97, dot(d, normalize(vec3(-0.55,0.75,0.45))));',
        ' float s2 = smoothstep(0.86-rough*0.5, 0.99, dot(d, normalize(vec3(0.75,0.30,-0.35))));',
        ' return c + (vec3(2.6,2.45,2.3)*s1 + vec3(0.9,1.0,1.2)*s2)*w; }',
        'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }',
        'vec3 brdf(vec3 N, vec3 V, vec3 L, vec3 diff, vec3 F0, float rough){',
        ' vec3 H = normalize(L+V); float NdL = max(dot(N,L),0.0); float NdV = max(dot(N,V),0.001); float NdH = max(dot(N,H),0.0);',
        ' float a = rough*rough; float a2 = a*a; float dd = NdH*NdH*(a2-1.0)+1.0; float Dg = a2/(3.14159*dd*dd);',
        ' vec3 F = F0 + (1.0-F0)*pow(1.0-max(dot(H,V),0.0), 5.0);',
        ' float k = (rough+1.0)*(rough+1.0)/8.0; float G = NdL/(NdL*(1.0-k)+k)*NdV/(NdV*(1.0-k)+k);',
        ' return (diff/3.14159 + Dg*F*G/(4.0*NdL*NdV+0.001))*NdL; }',
        'void main(){',
        ' vec3 fn = normalize(cross(dFdx(vPos), dFdy(vPos)));',
        ' bool back = dot(fn, normalize(vN)) < 0.0;',
        ' if (uCutOn && dot(vPos, uCutN) > uCutD) discard;',
        ' if (uIdOn) { gl_FragColor = vec4(uId, 1.0); return; }',
        ' if (uCutOn && back) { gl_FragColor = vec4(uCutCol, 1.0); return; }',
        ' vec3 V = normalize(uEye - vPos);',
        ' vec3 N = normalize(vN); if (back) N = -N;',
        ' vec3 bc = uCol; float mt = uMetal; float rg = uRough;',
        ' if (uTexOn) { vec4 tx = texture2D(uTex, vU); bc = mix(bc, tx.rgb, tx.a); mt = mix(mt, 0.0, tx.a); rg = mix(rg, 0.75, tx.a); }',
        ' vec3 F0 = mix(vec3(0.04), bc, mt); vec3 diff = bc*(1.0-mt);',
        ' float sh = uShadowOn ? shadowAt(N) : 1.0;',
        ' vec3 col = brdf(N,V,uLight,diff,F0,rg)*vec3(1.0,0.97,0.92)*sh*3.14159;',
        ' float NdV = max(dot(N,V),0.0);',
        ' vec3 Fr = F0 + (max(vec3(1.0-rg),F0)-F0)*pow(1.0-NdV, 5.0);',
        ' float occ = 0.55 + 0.45*sh;',
        ' col += diff*mix(vec3(0.07,0.065,0.06), vec3(0.24,0.26,0.30), N.y*0.5+0.5)*occ;',
        ' col += envMap(reflect(-V, N), rg)*Fr*mix(0.35,1.0,occ)*(1.0 - 0.6*rg);',
        ' gl_FragColor = vec4(pow(aces(col), vec3(1.0/2.2)), 1.0); }'
    ].join('\n');
    var DEPTH_VS = [
        'attribute vec3 aP; uniform mat4 uLVP; uniform mat4 uM; varying vec3 vPos;',
        'void main(){ vec4 w = uM*vec4(aP,1.0); vPos = w.xyz; gl_Position = uLVP*w; }'
    ].join('\n');
    var DEPTH_FS = [
        'precision highp float; varying vec3 vPos; uniform vec3 uCutN; uniform float uCutD; uniform bool uCutOn;',
        'vec4 pack(float d){ vec4 e = fract(vec4(1.0,255.0,65025.0,16581375.0)*d); return e - e.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0); }',
        'void main(){ if (uCutOn && dot(vPos, uCutN) > uCutD) discard; gl_FragColor = pack(gl_FragCoord.z); }'
    ].join('\n');

    function createRenderer(canvas, opts) {
        opts = opts || {};
        var R = {
                ok: true,
                reason: '',
                gl: null
            },
            gl = null,
            ext = {};
        var stdP = null,
            depthP = null,
            shadowFB = null,
            shadowTex = null,
            shadowRB = null,
            SH = 0;
        var pickFB = null,
            pickTex = null,
            pickRB = null,
            pickW = 0,
            pickH = 0,
            picking = false,
            curId = 0;

        try {
            gl = canvas.getContext('webgl', {
                antialias: true,
                alpha: false,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance'
            });
        } catch (e) {
            gl = null;
        }
        if (!gl) {
            R.ok = false;
            R.reason = '3D needs WebGL, which this browser has turned off.';
            return R;
        }
        ext.deriv = gl.getExtension('OES_standard_derivatives');
        ext.uint = gl.getExtension('OES_element_index_uint');
        if (!ext.deriv || !ext.uint) {
            R.ok = false;
            R.reason = '3D needs a newer graphics driver (WebGL extensions missing).';
            return R;
        }
        R.gl = gl;

        function prog(vs, fs) {
            function sh(type, src) {
                var s = gl.createShader(type);
                gl.shaderSource(s, src);
                gl.compileShader(s);
                if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                    if (window.console) console.error(gl.getShaderInfoLog(s));
                    return null;
                }
                return s;
            }
            var a = sh(gl.VERTEX_SHADER, vs),
                b = sh(gl.FRAGMENT_SHADER, fs);
            if (!a || !b) return null;
            var p = gl.createProgram();
            gl.attachShader(p, a);
            gl.attachShader(p, b);
            gl.bindAttribLocation(p, 0, 'aP');
            gl.bindAttribLocation(p, 1, 'aN');
            gl.bindAttribLocation(p, 2, 'aU');
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
                if (window.console) console.error(gl.getProgramInfoLog(p));
                return null;
            }
            p._u = {};
            return p;
        }

        function U(p, name) {
            if (!(name in p._u)) p._u[name] = gl.getUniformLocation(p, name);
            return p._u[name];
        }
        R.prog = prog;
        R.U = U;

        function upload(g) {
            var m = {
                n: g.i.length,
                bb: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]
            };
            for (var q = 0; q < g.p.length; q += 3)
                for (var d = 0; d < 3; d++) {
                    m.bb[d] = Math.min(m.bb[d], g.p[q + d]);
                    m.bb[d + 3] = Math.max(m.bb[d + 3], g.p[q + d]);
                }
            m.pb = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, m.pb);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.p), gl.STATIC_DRAW);
            m.nb = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, m.nb);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.n), gl.STATIC_DRAW);
            m.ub = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, m.ub);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.u), gl.STATIC_DRAW);
            m.ib = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.i), gl.STATIC_DRAW);
            return m;
        }

        function free(m) {
            if (!m) return;
            [m.pb, m.nb, m.ub, m.ib].forEach(function(b) {
                gl.deleteBuffer(b);
            });
        }
        /* bind(mesh, prog): position-only for the depth program, full attributes otherwise.
           For the standard program it also feeds the shadow map and the id-pick state. */
        function bind(m, p) {
            var normals = p !== depthP;
            gl.bindBuffer(gl.ARRAY_BUFFER, m.pb);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
            if (normals) {
                gl.bindBuffer(gl.ARRAY_BUFFER, m.nb);
                gl.enableVertexAttribArray(1);
                gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, m.ub);
                gl.enableVertexAttribArray(2);
                gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
            } else {
                gl.disableVertexAttribArray(1);
                gl.disableVertexAttribArray(2);
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
            if (p && p === stdP) {
                gl.uniform1i(U(p, 'uIdOn'), picking ? 1 : 0);
                if (picking) gl.uniform3f(U(p, 'uId'), (curId & 255) / 255, (curId >> 8) / 255, 1);
                if (shadowTex) {
                    gl.activeTexture(gl.TEXTURE3);
                    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.uniform1i(U(p, 'uShadow'), 3);
                    gl.uniform1f(U(p, 'uShadowTexel'), 1 / (SH || 1));
                }
            }
        }
        R.upload = upload;
        R.free = free;
        R.bind = bind;

        function build() {
            stdP = prog(STD_VS, STD_FS);
            depthP = prog(DEPTH_VS, DEPTH_FS);
            if (!stdP || !depthP) {
                R.ok = false;
                R.reason = '3D could not start on this device.';
                return false;
            }
            shadowTex = gl.createTexture();
            shadowFB = null;
            SH = 0;
            return true;
        }
        if (!build()) return R;
        R.stdProgram = function() {
            return stdP;
        };

        /* Depth-in-RGBA shadow map. drawFn(depthProg) sets uM per item, calls R.bind(mesh, depthProg) and draws. */
        R.shadowPass = function(drawFn, lightVP, size) {
            size = size || 1024;
            if (size !== SH || !shadowFB) {
                if (shadowFB) {
                    gl.deleteFramebuffer(shadowFB);
                    gl.deleteRenderbuffer(shadowRB);
                }
                gl.bindTexture(gl.TEXTURE_2D, shadowTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                shadowRB = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, shadowRB);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
                shadowFB = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowRB);
                SH = size;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
            gl.viewport(0, 0, size, size);
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);
            gl.useProgram(depthP);
            gl.uniformMatrix4fv(U(depthP, 'uLVP'), false, lightVP);
            gl.uniform1i(U(depthP, 'uCutOn'), 0);
            drawFn(depthP);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        };

        /* Picking: drawIdFn(setId) draws the scene with the standard program; every mesh bound
           after setId(n) comes out as the flat colour r = n & 255, g = n >> 8, b = 255. */
        R.pickPass = function(drawIdFn, w, h) {
            if (!pickFB || pickW !== w || pickH !== h) {
                if (pickFB) {
                    gl.deleteFramebuffer(pickFB);
                    gl.deleteTexture(pickTex);
                    gl.deleteRenderbuffer(pickRB);
                }
                pickTex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, pickTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                pickRB = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, pickRB);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
                pickFB = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, pickFB);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickRB);
                pickW = w;
                pickH = h;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, pickFB);
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);
            picking = true;
            curId = 0;
            try {
                drawIdFn(function(id) {
                    curId = id | 0;
                });
            } finally {
                picking = false;
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
        };
        /* x, y in pixels of the pick buffer, y from the top. 0 = nothing. */
        R.pickAt = function(x, y) {
            if (!pickFB) return 0;
            var px = new Uint8Array(4);
            gl.bindFramebuffer(gl.FRAMEBUFFER, pickFB);
            gl.readPixels(Math.round(x), Math.round(pickH - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return px[2] > 128 ? px[0] + 256 * px[1] : 0;
        };

        R.resize = function(cssW, cssH, dprMax) {
            var dpr = Math.min(window.devicePixelRatio || 1, dprMax || 2);
            var w = Math.max(1, Math.round(cssW * dpr)),
                h = Math.max(1, Math.round(cssH * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            return {
                w: w,
                h: h,
                dpr: dpr
            };
        };
        R.caps = function() {
            var dbg = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
            };
        };

        canvas.addEventListener('webglcontextlost', function(e) {
            e.preventDefault();
            R.ok = false;
            R.reason = 'lost';
            if (opts.onLost) opts.onLost();
        });
        canvas.addEventListener('webglcontextrestored', function() {
            ext.deriv = gl.getExtension('OES_standard_derivatives');
            ext.uint = gl.getExtension('OES_element_index_uint');
            pickFB = null;
            pickW = pickH = 0;
            if (build()) {
                R.ok = true;
                R.reason = '';
            }
            if (opts.onRestored) opts.onRestored();
        });
        return R;
    }

    var api = {
        GL3D_VER: GL3D_VER,
        /* maths */
        M4: M4,
        mul: mul,
        chain: chain,
        T: T,
        Sc: Sc,
        RX: RX,
        RY: RY,
        RZ: RZ,
        persp: persp,
        ortho: ortho,
        sub: sub,
        add: add,
        scl: scl,
        dot: dot,
        cross: cross,
        len: len,
        nrm: nrm,
        lookAt: lookAt,
        xf: xf,
        xfv: xfv,
        clamp: clamp,
        smooth: smooth,
        mod: mod,
        /* geometry */
        Geo: Geo,
        lathe: lathe,
        rod: rod,
        extrude: extrude,
        box: box,
        cylWall: cylWall,
        annulus: annulus,
        tube: tube,
        helix: helix,
        /* camera, tiers, time */
        orbitEye: orbitEye,
        TIERS: TIERS,
        pickTier: pickTier,
        makeGovernor: makeGovernor,
        clampDt: clampDt,
        viewCube: viewCube,
        /* runtime */
        createRenderer: createRenderer
    };
    if (typeof window !== 'undefined') window.GL3D = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();