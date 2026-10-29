/* Vernier Caliper — operable 3D view. Loaded on first use by app.js after
   shared/gl3d.js. Stores no reading: every number comes from the host
   (app.js [VC-3DHOST]). Spec: docs/superpowers/specs/2026-10-16-vernier-caliper-3d-design.md */
(function() {
    'use strict';
    // [VC-3D-BEGIN]
    var K = (typeof GL3D !== 'undefined' && GL3D) || (typeof window !== 'undefined' && window.GL3D);
    // The CAD view cube lives in the kit (gl3d.js v3+); an older cached kit simply has no cube.
    var VCUBE = K && K.viewCube,
        CUBE_PITCH = VCUBE ? VCUBE.VC.PITCH_MAX : 1.45;
    var D2R = Math.PI / 180,
        TAU = 2 * Math.PI;

    /* True-size instrument, mm. Proportions of a common 150 mm vernier caliper (beam 16 x 3.5 mm,
       outside jaws 40 mm deep, inside jaws ~16 mm), generic, no brand marks. Axis u along the beam
       with the fixed outside jaw face at u = 0; +y up; +z toward the default camera.
       Change values HERE only — every position below is derived from this table. */
    var VC3D_DIM = {
        beamU0: -16,
        beamU1: 180,
        beamH: 16,
        beamT: 3.5,
        grooveY0: 6.0,
        grooveY1: 10.0,
        grooveZ: 1.15, // depth-rod groove in the back of the beam, z from the back face
        datumY: 2.2, // main-scale datum: where the vernier edge meets the beam
        jawDepth: 40,
        jawFaceTop: 0,
        jawFaceBot: 37.5, // outside jaws hang 40 mm below the beam
        headLen: 70,
        headBot: -9.5,
        railTop: 20.11,
        plateZ0: 1.85,
        plateZ1: 3.35,
        bevelBot: -5.5,
        standoff: 0.25, // vernier edge above the main scale (parallax)
        clr: 0.1, // running clearance slider / beam
        nibZ: 1.6,
        nibBevel: 0.5, // inside jaws: each blade half the beam thick, knife edge bevelled
        rodW: 3.6,
        rodT: 0.95,
        rodAnchor: 6.0, // depth rod section and where it is pinned to the slider
        lockU: 11.35,
        lockR: 3.6,
        lockH: 5.5,
        rollerU: 58,
        rollerR: 4.0,
        rollerW: 3.0,
        rollerY: -13.6,
        ringH: 3.8,
        ringY0: 30.6,
        ringWall: 5.0, // a bore: the bush round the blades' tips
        depthFloor: 8,
        depthBlockY: 15,
        depthBlockZ: 13,
        depthBoreMax: 12,
        partY: -23.5 // outside parts sit centred on the jaw faces
    };
    // derived
    // The jaw outlines are TRACED from the 2D drawing's own sprites (assets/vernier_base.png for the fixed
    // jaws, assets/vernier1.png for the slider's), so the two views show one instrument. Sprite px -> mm:
    // the beam is 74 px tall in the sprite (y 97..171) and 16 mm here; the outside jaw face is sprite x 67.
    var SK = 16 / 74;

    function spr(x, y) {
        return [(x - 67) * SK, (171 - y) * SK];
    }
    VC3D_DIM.nibU = (32.25 - 67) * SK; // both inside measuring edges when closed (u)
    VC3D_DIM.nibTip = (171 - 4.5) * SK; // the blades' tips
    VC3D_DIM.rodY = (VC3D_DIM.grooveY0 + VC3D_DIM.grooveY1) / 2;
    VC3D_DIM.rodZ = -VC3D_DIM.beamT / 2 + VC3D_DIM.grooveZ / 2 + 0.05;
    VC3D_DIM.beamFront = VC3D_DIM.beamT / 2;

    /* ── Pose. state.mm (TRUE gap) places the slider, both sliding jaws and the rod; the vernier
       plate sits at obs = mm + zero error, which is what a zero error physically is. ── */
    function vcPose(H) {
        var st = H.st,
            ze = H.getZeOffsetMm(),
            D = VC3D_DIM;
        // The loose bush stands off to the left while the nibs are shut too tight for it: until the sliding
        // nib's back corner — a nib thickness behind its edge, and nibZ off the diameter's plane, where the
        // bore wall has already curved in by ri − √(ri² − nibZ²) — clears the wall (0.15 mm to spare).
        var ring = 0;
        if (H.wpIsInternal()) {
            var ri = st.wp.mm / 2,
                sag = ri - Math.sqrt(Math.max(0, ri * ri - D.nibZ * D.nibZ));
            ring = Math.max(0, bladeWidth(true, D.ringY0) + 0.15 + sag - st.mm);
        }
        return {
            gap: st.mm,
            obs: st.mm + ze,
            ze: ze,
            sliderU: st.mm,
            plateU: st.mm + ze,
            rodTipU: D.beamU1 + st.mm,
            nibFixedU: D.nibU,
            nibSlideU: D.nibU + st.mm,
            ringShift: ring,
            rollerAngle: -st.mm / D.rollerR,
            locked: !!st.locked
        };
    }

    /* ── Scale marks. The rules are the 2D drawCaliper's, mark for mark (the gate RUNS the 2D section
       against a recording context and matches every tick and numeral). hPx is the 2D tick height in
       the 2D drawing's own px, len the engraved length in mm at the 2D scale (px / px-per-mm). ── */
    var QUARTER = ['', '¼', '½', '¾'];

    function vcMainMarks(H) {
        var D = VC3D_DIM,
            ppm = H.getPxPerMm(),
            msd = H.getMsdMm(),
            cap = H.getMainDivs(),
            out = [];
        var imp = H.isImperial(),
            frac = H.impFractional(),
            MAJ = 22,
            MIN = 13;
        var labelGap = 0,
            msdPx = H.getMsdPx();
        if (!imp) {
            while (msdPx * labelGap < 50) labelGap += 10;
        }
        var beamCm = H.st.beamUnit === 'cm';
        for (var i = 0;; i++) {
            var u = i * msd;
            if (u > D.beamU1 - 1.2) break;
            var m = {
                i: i,
                u: u,
                label: null,
                bold: false,
                fontPx: 0
            };
            if (frac) {
                var inch = i % 16 === 0;
                m.hPx = inch ? MAJ : (i % 8 === 0) ? MAJ - 3 : (i % 4 === 0) ? MAJ - 6 : (i % 2 === 0) ? MAJ - 9 : MAJ - 12;
                m.wPx = inch ? 1.8 : (i % 4 === 0 ? 1.2 : 0.7);
                if (i <= cap) {
                    if (inch) {
                        m.label = String(i / 16);
                        m.bold = true;
                        m.fontPx = 14.67;
                    } else if (i % 4 === 0) {
                        m.label = QUARTER[(i % 16) / 4];
                        m.fontPx = 9.33;
                    }
                }
            } else if (imp) {
                var inch2 = i % 40 === 0,
                    tenth = i % 4 === 0;
                m.hPx = inch2 ? MAJ : (tenth ? MAJ - 5 : MIN);
                m.wPx = inch2 ? 1.8 : (tenth ? 1.2 : 0.7);
                if (i <= cap) {
                    if (inch2) {
                        m.label = String(i / 40);
                        m.bold = true;
                        m.fontPx = 14.67;
                    } else if (tenth) {
                        m.label = String((i % 40) / 4);
                        m.fontPx = 8.67;
                    }
                }
            } else {
                m.hPx = (i % 5 === 0) ? MAJ : MIN;
                m.wPx = (i % 5 === 0) ? 1.4 : 0.8;
                if (i % labelGap === 0 && i <= cap) {
                    m.label = String(beamCm ? i / 10 : i);
                    m.fontPx = 12;
                }
            }
            m.len = m.hPx / ppm;
            out.push(m);
        }
        return out;
    }

    function vcVsdMm(H) {
        var n = H.getVsdCount();
        return H.getMsdMm() * (H.getVernierMult() * n - 1) / n;
    }

    function vcVernierMarks(H) {
        var n = H.getVsdCount(),
            vsd = vcVsdMm(H),
            ppm = H.getPxPerMm();
        var rule = H.getVernierLabelRule(H.isImperial(), n, H.getVsdPx(), H.getLcMm()),
            out = [];
        for (var j = 0; j <= n; j++) {
            var lab = j % rule.gap === 0;
            out.push({
                j: j,
                du: j * vsd,
                hPx: lab ? 10 : 8,
                len: (lab ? 10 : 8) / ppm,
                wPx: lab ? 1.2 : 0.7,
                label: lab ? String(rule.val(j)) : null
            });
        }
        return out;
    }
    // The coincidence read off the 3D geometry: the vernier line nearest a main line, at the
    // QUANTISED observed reading, exactly as getAlignedIdx() and the tiles quantise.
    function vcCoincidence(H) {
        var q = H.getQuantMm(),
            vsd = vcVsdMm(H),
            msd = H.getMsdMm(),
            n = H.getVsdCount(),
            best = -1,
            bd = Infinity,
            misses = [];
        for (var j = 0; j <= n; j++) {
            var u = q + j * vsd,
                k = Math.round(u / msd),
                d = Math.abs(u - k * msd);
            misses.push(d);
            if (j < n && d < bd - 1e-12) {
                bd = d;
                best = j;
            }
        }
        return {
            j: best,
            miss: bd,
            misses: misses
        };
    }

    /* ── Double-precision transforms. The gate measures faces to 1e-9 mm; Float32 cannot. ── */
    function dI() {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }

    function dmul(a, b) {
        var o = new Array(16);
        for (var c = 0; c < 4; c++)
            for (var r = 0; r < 4; r++)
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        return o;
    }

    function dchain() {
        var m = arguments[0];
        for (var i = 1; i < arguments.length; i++) m = dmul(m, arguments[i]);
        return m;
    }

    function dT(x, y, z) {
        var m = dI();
        m[12] = x;
        m[13] = y;
        m[14] = z;
        return m;
    }

    function dS(x, y, z) {
        var m = dI();
        m[0] = x;
        m[5] = y;
        m[10] = z;
        return m;
    }

    function dRX(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = dI();
        m[5] = c;
        m[6] = s;
        m[9] = -s;
        m[10] = c;
        return m;
    }

    function dRY(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = dI();
        m[0] = c;
        m[2] = -s;
        m[8] = s;
        m[10] = c;
        return m;
    }

    function dRZ(a) {
        var c = Math.cos(a),
            s = Math.sin(a),
            m = dI();
        m[0] = c;
        m[1] = s;
        m[4] = -s;
        m[5] = c;
        return m;
    }
    // (x, y, z) -> (z, x, y): a prism built in XY and extruded along Z becomes one along u.
    var CYC = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

    /* Edge-pairing closed-surface test (verify-gl3d.js §2), the rule the cut shader relies on. */
    function _closed(g) {
        function key(i) {
            return [g.p[3 * i], g.p[3 * i + 1], g.p[3 * i + 2]].map(function(x) {
                return x.toFixed(6).replace(/^-(0\.0+)$/, '$1');
            }).join();
        }
        var e = new Map();
        for (var i = 0; i < g.i.length; i += 3) {
            var k = [key(g.i[i]), key(g.i[i + 1]), key(g.i[i + 2])];
            if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
            for (var j = 0; j < 3; j++) {
                var a = k[j],
                    b = k[(j + 1) % 3],
                    kk = a < b ? a + '|' + b : b + '|' + a;
                e.set(kk, (e.get(kk) || 0) + 1);
            }
        }
        var ok = e.size > 0;
        e.forEach(function(c) {
            if (c !== 2) ok = false;
        });
        return ok;
    }

    /* ── Builders. Each makes closed shells with outward normals. ── */
    function h2(a, b) {
        var x = a[0] + b[0],
            y = a[1] + b[1],
            l = Math.hypot(x, y) || 1;
        return [x / l, y / l];
    }

    function polyArea(P) {
        var a = 0;
        for (var i = 0; i < P.length; i++) {
            var p = P[i],
                q = P[(i + 1) % P.length];
            a += p[0] * q[1] - q[0] * p[1];
        }
        return a / 2;
    }

    function earClip(P) {
        var idx = P.map(function(_, i) {
                return i;
            }),
            tris = [],
            guard = 0;

        function cr(a, b, c) {
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        }
        while (idx.length > 3 && guard++ < 100000) {
            var found = false;
            for (var i = 0; i < idx.length && !found; i++) {
                var ia = idx[(i + idx.length - 1) % idx.length],
                    ib = idx[i],
                    ic = idx[(i + 1) % idx.length];
                var a = P[ia],
                    b = P[ib],
                    c = P[ic];
                if (cr(a, b, c) <= 1e-12) continue;
                var inside = false;
                for (var j = 0; j < idx.length && !inside; j++) {
                    var q = idx[j];
                    if (q === ia || q === ib || q === ic) continue;
                    var p = P[q];
                    if (cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12) inside = true;
                }
                if (inside) continue;
                tris.push([ia, ib, ic]);
                idx.splice(i, 1);
                found = true;
            }
            if (!found) break;
        }
        if (idx.length === 3) tris.push(idx.slice());
        return tris;
    }
    /* A flat-faced prism: a simple polygon in the (a, b) plane extruded along c from c0 to c1, then
       laid into the world by `place` (a permutation matrix). uvFn(edge, a, b, c) gives a side's UV,
       null leaves it untextured. Flat normals: every side is a separate face. */
    function prism(g, poly, c0, c1, place, uvFn) {
        // reversing would renumber the edges uvFn keys on, so a textured prism must be given CCW
        if (polyArea(poly) < 0) {
            if (uvFn) throw new Error('prism: textured outline must be CCW');
            poly = poly.slice().reverse();
        }
        var n = poly.length,
            base = g.mark(),
            i;
        for (i = 0; i < n; i++) {
            var p = poly[i],
                q = poly[(i + 1) % n],
                da = q[0] - p[0],
                db = q[1] - p[1],
                l = Math.hypot(da, db) || 1;
            var na = db / l,
                nb = -da / l;

            function uv(a, b, c) {
                return uvFn ? (uvFn(i, a, b, c) || [0, 0]) : [0, 0];
            }
            var u0 = uv(p[0], p[1], c0),
                u1 = uv(q[0], q[1], c0),
                u2 = uv(q[0], q[1], c1),
                u3 = uv(p[0], p[1], c1);
            var v0 = g.v(p[0], p[1], c0, na, nb, 0, u0[0], u0[1]),
                v1 = g.v(q[0], q[1], c0, na, nb, 0, u1[0], u1[1]);
            var v2 = g.v(q[0], q[1], c1, na, nb, 0, u2[0], u2[1]),
                v3 = g.v(p[0], p[1], c1, na, nb, 0, u3[0], u3[1]);
            g.quad(v0, v1, v2, v3);
        }
        var tris = earClip(poly);
        [
            [c0, -1],
            [c1, 1]
        ].forEach(function(cap) {
            var first = g.mark();
            for (var t = 0; t < n; t++) g.v(poly[t][0], poly[t][1], cap[0], 0, 0, cap[1]);
            tris.forEach(function(tr) {
                g.tri(first + tr[0], first + tr[1], first + tr[2]);
            });
        });
        if (place) g.xform(base, place);
    }
    // An axis-aligned box (world axes), a closed shell with flat outward normals.
    function boxW(g, x0, x1, y0, y1, z0, z1) {
        prism(g, [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1]
        ], z0, z1, null, null);
    }
    /* Revolve a closed (x, r) loop about +X (from screw-gauge 3D). */
    function revX(g, loop, seg, smoothDeg) {
        var n = loop.length,
            area = 0,
            i, k, en = [];
        for (i = 0; i < n; i++) {
            var a = loop[i],
                b = loop[(i + 1) % n];
            area += a[0] * b[1] - b[0] * a[1];
        }
        var sg = area > 0 ? 1 : -1;
        for (i = 0; i < n; i++) {
            var p = loop[i],
                q = loop[(i + 1) % n],
                dx = q[0] - p[0],
                dr = q[1] - p[1],
                l = Math.hypot(dx, dr) || 1;
            en.push([sg * dr / l, -sg * dx / l]);
        }
        var cosT = Math.cos((smoothDeg == null ? 30 : smoothDeg) * D2R);
        for (i = 0; i < n; i++) {
            var A = loop[i],
                B = loop[(i + 1) % n];
            if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-12 || (A[1] < 1e-9 && B[1] < 1e-9)) continue;
            var e = en[i],
                ep = en[(i - 1 + n) % n],
                ex = en[(i + 1) % n];
            var nA = e[0] * ep[0] + e[1] * ep[1] > cosT ? h2(e, ep) : e,
                nB = e[0] * ex[0] + e[1] * ex[1] > cosT ? h2(e, ex) : e;
            var base = g.mark();
            for (k = 0; k <= seg; k++) {
                var t = TAU * k / seg,
                    c = Math.cos(t),
                    s = Math.sin(t);
                g.v(A[0], A[1] * c, A[1] * s, nA[0], nA[1] * c, nA[1] * s, A[0], k / seg);
                g.v(B[0], B[1] * c, B[1] * s, nB[0], nB[1] * c, nB[1] * s, B[0], k / seg);
            }
            for (k = 0; k < seg; k++) {
                var q2 = base + 2 * k;
                g.quad(q2, q2 + 2, q2 + 3, q2 + 1);
            }
        }
    }

    function quadFace(g, a, b, c, d, n) {
        var i0 = g.v(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0),
            i1 = g.v(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0);
        var i2 = g.v(c[0], c[1], c[2], n[0], n[1], n[2], 1, 1),
            i3 = g.v(d[0], d[1], d[2], n[0], n[1], n[2], 0, 1);
        g.quad(i0, i1, i2, i3);
    }
    /* A prism along X between an outer and an inner loop in (y, z) with equal point counts. */
    function ringPrismX(g, outer, inner, x0, x1, radialIn) {
        var n = outer.length,
            i;

        function nrm2(p, s) {
            var l = Math.hypot(p[0], p[1]) || 1;
            return [s * p[0] / l, s * p[1] / l];
        }

        function wall(pts, sgn, radial) {
            for (var i = 0; i < n; i++) {
                var a = pts[i],
                    b = pts[(i + 1) % n],
                    dy = b[0] - a[0],
                    dz = b[1] - a[1],
                    l = Math.hypot(dy, dz) || 1;
                var ny = dz / l,
                    nz = -dy / l;
                if ((a[0] + b[0]) * ny + (a[1] + b[1]) * nz < 0) {
                    ny = -ny;
                    nz = -nz;
                }
                ny *= sgn;
                nz *= sgn;
                var na = radial ? nrm2(a, sgn) : [ny, nz],
                    nb = radial ? nrm2(b, sgn) : [ny, nz];
                var i0 = g.v(x0, a[0], a[1], 0, na[0], na[1]),
                    i1 = g.v(x0, b[0], b[1], 0, nb[0], nb[1]);
                var i2 = g.v(x1, b[0], b[1], 0, nb[0], nb[1]),
                    i3 = g.v(x1, a[0], a[1], 0, na[0], na[1]);
                g.quad(i0, i1, i2, i3);
            }
        }
        wall(outer, 1, false);
        wall(inner, -1, !!radialIn);
        [
            [x0, -1],
            [x1, 1]
        ].forEach(function(cap) {
            for (i = 0; i < n; i++) {
                var o0 = outer[i],
                    o1 = outer[(i + 1) % n],
                    n0 = inner[i],
                    n1 = inner[(i + 1) % n];
                quadFace(g, [cap[0], o0[0], o0[1]], [cap[0], o1[0], o1[1]], [cap[0], n1[0], n1[1]], [cap[0], n0[0], n0[1]], [cap[1], 0, 0]);
            }
        });
    }

    function knurlRing(g, x0, x1, rPeak, rValley, rIn, n) {
        var out = [],
            inn = [];
        for (var j = 0; j < 2 * n; j++) {
            var t = Math.PI * j / n,
                r = j % 2 ? rValley : rPeak;
            out.push([r * Math.cos(t), r * Math.sin(t)]);
            inn.push([rIn * Math.cos(t), rIn * Math.sin(t)]);
        }
        ringPrismX(g, out, inn, x0, x1, true);
    }
    /* Extrude an outline in XY from z0 to z1 with chamfered edges of size ch on both faces. */
    function extrudeCh(g, poly, z0, z1, ch) {
        if (polyArea(poly) < 0) poly = poly.slice().reverse();
        var n = poly.length,
            en = [],
            vin = [],
            i;
        for (i = 0; i < n; i++) {
            var p = poly[i],
                q = poly[(i + 1) % n],
                dx = q[0] - p[0],
                dy = q[1] - p[1],
                l = Math.hypot(dx, dy) || 1;
            en.push([dy / l, -dx / l]);
        }
        for (i = 0; i < n; i++) {
            var m = h2(en[(i - 1 + n) % n], en[i]),
                d = ch / Math.max(0.35, m[0] * en[i][0] + m[1] * en[i][1]);
            vin.push([poly[i][0] - m[0] * d, poly[i][1] - m[1] * d]);
        }
        var zs = [z0, z0 + ch, z1 - ch, z1],
            rings = [vin, poly, poly, vin];
        var cosT = Math.cos(35 * D2R);
        for (i = 0; i < n; i++) {
            var j = (i + 1) % n,
                e = en[i],
                ep = en[(i - 1 + n) % n],
                ex = en[j];
            var nP = e[0] * ep[0] + e[1] * ep[1] > cosT ? h2(e, ep) : e,
                nQ = e[0] * ex[0] + e[1] * ex[1] > cosT ? h2(e, ex) : e;
            for (var b = 0; b < 3; b++) {
                var r0 = rings[b],
                    r1 = rings[b + 1],
                    k = b === 0 ? -1 : (b === 2 ? 1 : 0),
                    w = k ? 0.7071 : 1;
                var v0 = g.v(r0[i][0], r0[i][1], zs[b], nP[0] * w, nP[1] * w, k * 0.7071);
                var v1 = g.v(r0[j][0], r0[j][1], zs[b], nQ[0] * w, nQ[1] * w, k * 0.7071);
                var v2 = g.v(r1[j][0], r1[j][1], zs[b + 1], nQ[0] * w, nQ[1] * w, k * 0.7071);
                var v3 = g.v(r1[i][0], r1[i][1], zs[b + 1], nP[0] * w, nP[1] * w, k * 0.7071);
                g.quad(v0, v1, v2, v3);
            }
        }
        var tris = earClip(vin);
        [
            [z0, -1],
            [z1, 1]
        ].forEach(function(cap) {
            var first = g.mark();
            for (var t = 0; t < n; t++) g.v(vin[t][0], vin[t][1], cap[0], 0, 0, cap[1]);
            tris.forEach(function(tr) {
                g.tri(first + tr[0], first + tr[1], first + tr[2]);
            });
        });
    }

    /* ── Rounded edges. A real caliper has no knife-sharp arris anywhere but its measuring edges: every
       other edge is broken. filletPoly rounds a polygon's CONVEX corners with true arcs (radius rfn(corner),
       never more than 45 % of either side) and tags each arc point with its outward radial normal;
       extrudeR extrudes it with small chamfers on both faces and smooth normals ON the arcs only, so a
       highlight rolls round each rounded edge while every flat face stays flat-shaded. ── */
    function filletPoly(P, rfn, seg) {
        if (polyArea(P) < 0) P = P.slice().reverse();
        var n = P.length,
            out = [],
            arc = 0;
        for (var i = 0; i < n; i++) {
            var A = P[(i - 1 + n) % n],
                B = P[i],
                C = P[(i + 1) % n];
            var cr = (B[0] - A[0]) * (C[1] - B[1]) - (B[1] - A[1]) * (C[0] - B[0]);
            var r = cr > 1e-12 ? (rfn(B, i) || 0) : 0;
            if (!r) {
                out.push({
                    p: B,
                    n: null,
                    arc: -1
                });
                continue;
            }
            var la = Math.hypot(A[0] - B[0], A[1] - B[1]),
                lc = Math.hypot(C[0] - B[0], C[1] - B[1]);
            var u1 = [(A[0] - B[0]) / la, (A[1] - B[1]) / la],
                u2 = [(C[0] - B[0]) / lc, (C[1] - B[1]) / lc];
            var th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
            var t = Math.min(r / Math.tan(th / 2), 0.45 * la, 0.45 * lc),
                re = t * Math.tan(th / 2);
            var bl = Math.hypot(u1[0] + u2[0], u1[1] + u2[1]) || 1,
                bis = [(u1[0] + u2[0]) / bl, (u1[1] + u2[1]) / bl];
            var cd = re / Math.sin(th / 2),
                c = [B[0] + bis[0] * cd, B[1] + bis[1] * cd];
            var p1 = [B[0] + u1[0] * t, B[1] + u1[1] * t],
                p2 = [B[0] + u2[0] * t, B[1] + u2[1] * t];
            var a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]),
                a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
            var da = a2 - a1;
            while (da > Math.PI) da -= TAU;
            while (da <= -Math.PI) da += TAU;
            for (var k = 0; k <= seg; k++) {
                var a = a1 + da * k / seg;
                out.push({
                    p: [c[0] + re * Math.cos(a), c[1] + re * Math.sin(a)],
                    n: [Math.cos(a), Math.sin(a)],
                    arc: arc
                });
            }
            arc++;
        }
        return out;
    }

    function extrudeR(g, pts, z0, z1, ch) {
        var P = pts.map(function(q) {
            return q.p;
        });
        if (polyArea(P) < 0) {
            pts = pts.slice().reverse();
            P = P.slice().reverse();
        }
        var n = P.length,
            en = [],
            vin = [],
            i;
        for (i = 0; i < n; i++) {
            var p = P[i],
                q = P[(i + 1) % n],
                dx = q[0] - p[0],
                dy = q[1] - p[1],
                l = Math.hypot(dx, dy) || 1;
            en.push([dy / l, -dx / l]);
        }
        for (i = 0; i < n; i++) {
            if (pts[i].arc >= 0) {
                vin.push([P[i][0] - pts[i].n[0] * ch, P[i][1] - pts[i].n[1] * ch]);
                continue;
            }
            var m = h2(en[(i - 1 + n) % n], en[i]),
                d = ch / Math.max(0.35, m[0] * en[i][0] + m[1] * en[i][1]);
            vin.push([P[i][0] - m[0] * d, P[i][1] - m[1] * d]);
        }
        var zs = [z0, z0 + ch, z1 - ch, z1],
            rings = [vin, P, P, vin];
        for (i = 0; i < n; i++) {
            var j = (i + 1) % n,
                onArc = pts[i].arc >= 0 && pts[i].arc === pts[j].arc;
            var nP = onArc ? pts[i].n : en[i],
                nQ = onArc ? pts[j].n : en[i];
            for (var b = 0; b < 3; b++) {
                var r0 = rings[b],
                    r1 = rings[b + 1],
                    k = b === 0 ? -1 : (b === 2 ? 1 : 0),
                    w = k ? 0.7071 : 1;
                var v0 = g.v(r0[i][0], r0[i][1], zs[b], nP[0] * w, nP[1] * w, k * 0.7071);
                var v1 = g.v(r0[j][0], r0[j][1], zs[b], nQ[0] * w, nQ[1] * w, k * 0.7071);
                var v2 = g.v(r1[j][0], r1[j][1], zs[b + 1], nQ[0] * w, nQ[1] * w, k * 0.7071);
                var v3 = g.v(r1[i][0], r1[i][1], zs[b + 1], nP[0] * w, nP[1] * w, k * 0.7071);
                g.quad(v0, v1, v2, v3);
            }
        }
        var tris = earClip(vin);
        [
            [z0, -1],
            [z1, 1]
        ].forEach(function(cap) {
            var first = g.mark();
            for (var t = 0; t < n; t++) g.v(vin[t][0], vin[t][1], cap[0], 0, 0, cap[1]);
            tris.forEach(function(tr) {
                g.tri(first + tr[0], first + tr[1], first + tr[2]);
            });
        });
    }
    // A rounded, chamfered solid: outline P in the (a, b) plane, extruded along c, then placed by `place`.
    function roundSolid(g, P, rfn, c0, c1, ch, place, seg) {
        var m0 = g.mark();
        // an arc tighter than the chamfer would turn inside out at the chamfer's inset: never let it
        var rf = typeof rfn === 'number' ? function() {
            return rfn;
        } : rfn;
        extrudeR(g, filletPoly(P, function(c, i) {
            var r = rf(c, i);
            return r > 0 ? Math.max(r, ch * 1.6) : 0;
        }, seg || 4), c0, c1, ch);
        if (place) g.xform(m0, place);
    }
    /* A decal: a thin closed slab standing `t` proud of a face, from A to B in the (a, b) plane, extruded
       along c, with UV only on its outer face (uvOf(a, b, c)). It carries an engraving texture over a
       rounded part whose own faces carry the plain grain. */
    function decal(g, A, B, nrmAB, t, c0, c1, place, uvOf) {
        var A2 = [A[0] + nrmAB[0] * t, A[1] + nrmAB[1] * t],
            B2 = [B[0] + nrmAB[0] * t, B[1] + nrmAB[1] * t];
        var poly = [A, B, B2, A2];
        if (polyArea(poly) < 0) poly = [A, A2, B2, B];
        var outer = -1;
        for (var i = 0; i < 4; i++) {
            var a = poly[i],
                b = poly[(i + 1) % 4];
            if ((a === A2 || a === B2) && (b === A2 || b === B2)) outer = i;
        }
        prism(g, poly, c0, c1, place, function(edge, x, y, z) {
            return edge === outer ? uvOf(x, y, z) : null;
        });
    }

    /* ── Outlines in the (u, y) plane, traced from the 2D sprites (see spr). ── */
    // Fixed outside jaw + the beam's left end it is forged with. Measuring face u = 0 below the root relief.
    function fixedJawPoly() {
        var D = VC3D_DIM;
        return [
            [D.beamU0, 0],
            [spr(64, 0)[0], 0],
            [spr(64, 215)[0], spr(0, 215)[1]],
            [0, spr(0, 217)[1]],
            [0, spr(0, 351)[1]],
            spr(65, 355), spr(60, 350), spr(49, 340), spr(39, 330), spr(33, 320), spr(21, 270), spr(9, 220), spr(6, 210), [spr(1, 190)[0], spr(1, 190)[1]],
            [D.beamU0, spr(1, 190)[1]]
        ];
    }
    // Sliding outside jaw in SLIDER coordinates (its face at 0), hanging from the slider skirt.
    function slideJawPoly() {
        var D = VC3D_DIM,
            t = D.headBot;
        return [
            [0, t],
            [0, spr(0, 351)[1]], spr(69, 355), spr(73, 350), spr(84, 340), spr(94, 330), spr(99, 320),
            spr(112, 270), spr(126, 220), [spr(127, 0)[0], t]
        ];
    }
    // Inside (upper) jaws: two half-spear blades. The FIXED blade's straight LEFT edge and the SLIDING blade's
    // straight RIGHT edge are the measuring edges; closed they meet on u = nibU and the pair is one spear, the
    // sliding half on the left. They lie in opposite halves of the beam's thickness (fixed behind, sliding in
    // front), so opening carries the sliding blade through the fixed one to the right — the crossed design.
    var FIXED_BLADE = [
        [32.25, 78],
        [62, 78],
        [62, 72],
        [61, 66],
        [59, 60],
        [57, 54],
        [56, 48],
        [54, 42],
        [53, 36],
        [51, 30],
        [49, 24],
        [47, 18],
        [43, 12],
        [37, 6],
        [33.5, 4.5],
        [32.25, 5.5]
    ];
    var SLIDE_BLADE = [
        [1, 78],
        [32.25, 78],
        [32.25, 5.5],
        [31, 4.5],
        [26, 6],
        [21, 12],
        [16, 18],
        [14, 24],
        [13, 30],
        [11, 36],
        [10, 42],
        [8, 48],
        [6, 54],
        [5, 60],
        [3, 66],
        [1, 72]
    ];

    function bladePoly(slide) {
        return (slide ? SLIDE_BLADE : FIXED_BLADE).map(function(p) {
            return spr(p[0], p[1]);
        });
    }
    // The blade's extent across u at height y (blade coordinates): the scanline of its outline.
    function bladeSpan(slide, y) {
        var P = bladePoly(slide),
            lo = Infinity,
            hi = -Infinity;
        for (var i = 0; i < P.length; i++) {
            var a = P[i],
                b = P[(i + 1) % P.length];
            if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
            var u = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
            lo = Math.min(lo, u);
            hi = Math.max(hi, u);
        }
        return {
            u0: lo,
            u1: hi
        };
    }

    function bladeWidth(slide, y) {
        var s = bladeSpan(slide, y);
        return s.u1 - s.u0;
    }
    /* A blade: the outline at z = 0 (the plane of the knife edge) lofted to z = zBack, where the measuring
       edge is set back `bevel` into the body — so a bore is touched ONLY on its diametral plane. */
    function bladeLoft(g, P, zBack, faceU, bevel) {
        if (polyArea(P) < 0) P = P.slice().reverse();
        // The back outline: the measuring edge set back by `bevel`, the far edge unmoved, and everything between
        // compressed in proportion — so the tip, which is narrower than the bevel, cannot fold over itself.
        var W = 0;
        P.forEach(function(p) {
            W = Math.max(W, Math.abs(p[0] - faceU));
        });
        var sg = bevel < 0 ? -1 : 1,
            bv = Math.abs(bevel);
        var n = P.length,
            Q = P.map(function(p) {
                var d = Math.abs(p[0] - faceU);
                return [faceU + sg * (bv + d * (1 - bv / W)), p[1]];
            });
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n,
                A = [P[i][0], P[i][1], 0],
                B = [P[j][0], P[j][1], 0],
                C = [Q[j][0], Q[j][1], zBack],
                Dd = [Q[i][0], Q[i][1], zBack];
            // oriented by the outline's own outward normal (a CCW outline: (dy, −du)), never by a centroid,
            // which a concave blade puts outside itself
            var nn = K.nrm(K.cross(K.sub(B, A), K.sub(Dd, A))),
                out2 = [B[1] - A[1], -(B[0] - A[0]), 0];
            if (K.dot(nn, out2) < 0) nn = K.scl(nn, -1);
            quadFace(g, A, B, C, Dd, nn);
        }
        var tris = earClip(P),
            sF = zBack < 0 ? 1 : -1;
        [
            [P, 0, sF],
            [Q, zBack, -sF]
        ].forEach(function(cap) {
            var first = g.mark();
            for (var t = 0; t < n; t++) g.v(cap[0][t][0], cap[0][t][1], cap[1], 0, 0, cap[2]);
            tris.forEach(function(tr) {
                g.tri(first + tr[0], first + tr[1], first + tr[2]);
            });
        });
    }

    /* Clip a polygon to the half-plane y ≥ yc (keep = 1) or y ≤ yc (keep = −1): Sutherland–Hodgman. */
    function clipY(P, yc, keep) {
        var out = [],
            n = P.length;

        function inside(p) {
            return keep > 0 ? p[1] >= yc - 1e-12 : p[1] <= yc + 1e-12;
        }
        for (var i = 0; i < n; i++) {
            var a = P[i],
                b = P[(i + 1) % n],
                ia = inside(a),
                ib = inside(b);
            if (ia) out.push(a);
            if (ia !== ib) {
                var t = (yc - a[1]) / (b[1] - a[1]);
                out.push([a[0] + (b[0] - a[0]) * t, yc]);
            }
        }
        return out;
    }

    function spanAt(P, y) {
        var lo = Infinity,
            hi = -Infinity;
        for (var i = 0; i < P.length; i++) {
            var a = P[i],
                b = P[(i + 1) % P.length];
            if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
            var u = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
            lo = Math.min(lo, u);
            hi = Math.max(hi, u);
        }
        return [lo, hi];
    }

    function ccw(P) {
        return polyArea(P) < 0 ? P.slice().reverse() : P;
    }
    /* An outside jaw's tip, as on a real caliper (the owner's photos): below a DIAGONAL line — high on the
       outer edge, low on the measuring edge — both faces are ground away as planes meeting in a thin knife tip,
       and the outer edge steps in by a small notch where the grind begins. Everything is cut INTO the jaw:
       nothing stands proud of its faces (review 10 — a full-thickness land block at the measuring edge read as a
       lump sticking out in z). The jaw above the line and the tip below it are two solids sharing the cut face.
       sgn: −1 the fixed jaw (body at u < 0), +1 the sliding one. */
    var JAW_TIP_OUT_Y = -32.5,
        JAW_TIP_MEAS_Y = -35.6,
        JAW_TIP_OUT_U = 7.1,
        JAW_TIP_T = 0.5,
        JAW_NOTCH = 0.6;

    function tipLine(sgn) { // {n, c}: n·p ≥ c is the tip side
        var A = [sgn * JAW_TIP_OUT_U, JAW_TIP_OUT_Y],
            B = [0, JAW_TIP_MEAS_Y],
            d = [B[0] - A[0], B[1] - A[1]];
        var l = Math.hypot(d[0], d[1]),
            n = [-d[1] / l, d[0] / l];
        if (n[1] > 0) n = [-n[0], -n[1]];
        return {
            n: n,
            c: n[0] * B[0] + n[1] * B[1]
        };
    }

    function clipHalf(P, L, keep) {
        var out = [],
            m = P.length;

        function f(p) {
            return L.n[0] * p[0] + L.n[1] * p[1] - L.c;
        }

        function inside(p) {
            return keep > 0 ? f(p) >= -1e-12 : f(p) <= 1e-12;
        }
        for (var i = 0; i < m; i++) {
            var a = P[i],
                b = P[(i + 1) % m],
                ia = inside(a),
                ib = inside(b);
            if (ia) out.push(a);
            if (ia !== ib) {
                var t = f(a) / (f(a) - f(b));
                out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
        }
        return out;
    }

    function onTipLine(c, sgn) {
        var L = tipLine(sgn);
        return Math.abs(L.n[0] * c[0] + L.n[1] * c[1] - L.c) < 1e-9;
    }

    function jawBody(poly, sgn) {
        return clipHalf(poly, tipLine(sgn), -1);
    }

    function jawTip(g, jawPoly, sgn, hb) {
        var L = tipLine(sgn);
        // the notch: the outer edge of the ground tip steps in towards the measuring edge
        var notched = jawPoly.map(function(p) {
            return p[0] * sgn > 0.7 ? [p[0] - sgn * JAW_NOTCH, p[1]] : p;
        });
        var P = ccw(clipHalf(notched, L, 1)),
            n = P.length,
            sMax = 0;

        function s(p) {
            return L.n[0] * p[0] + L.n[1] * p[1] - L.c;
        }
        P.forEach(function(p) {
            sMax = Math.max(sMax, s(p));
        });
        var k = (hb - JAW_TIP_T / 2) / sMax;

        function zt(p) {
            return hb - k * Math.max(0, s(p));
        }
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n,
                a = P[i],
                b = P[j],
                dx = b[0] - a[0],
                dy = b[1] - a[1],
                l = Math.hypot(dx, dy) || 1,
                nn = [dy / l, -dx / l, 0];
            quadFace(g, [a[0], a[1], -zt(a)], [b[0], b[1], -zt(b)], [b[0], b[1], zt(b)], [a[0], a[1], zt(a)], nn);
        }
        var tris = earClip(P),
            f0 = g.mark(),
            tn = K.nrm([k * L.n[0], k * L.n[1], 1]),
            bn = K.nrm([k * L.n[0], k * L.n[1], -1]);
        for (var t = 0; t < n; t++) g.v(P[t][0], P[t][1], zt(P[t]), tn[0], tn[1], tn[2]);
        tris.forEach(function(tr) {
            g.tri(f0 + tr[0], f0 + tr[1], f0 + tr[2]);
        });
        var f1 = g.mark();
        for (t = 0; t < n; t++) g.v(P[t][0], P[t][1], -zt(P[t]), bn[0], bn[1], bn[2]);
        tris.forEach(function(tr) {
            g.tri(f1 + tr[0], f1 + tr[2], f1 + tr[1]);
        });
    }

    /* Parts: the scene built from the tables above. */
    var PART_ID = {
        beam: 1,
        fixedJaw: 2,
        slider: 3,
        plate: 4,
        slideJaw: 5,
        slideNib: 6,
        roller: 7,
        lock: 8,
        rod: 9,
        part: 10,
        fixedNib: 2
    };
    var PICK_SLIDE = [3, 4, 5, 6, 9]; // a press on any of these slides the head
    var MAT = {
        chrome: {
            c: [0.80, 0.81, 0.82],
            r: 0.30,
            m: 1
        },
        satin: {
            c: [0.82, 0.83, 0.85],
            r: 0.34,
            m: 0.55
        }, // satin stainless: flat faces need some diffuse to read light
        ground: {
            c: [0.80, 0.81, 0.83],
            r: 0.28,
            m: 0.6
        },
        lapped: {
            c: [0.62, 0.63, 0.66],
            r: 0.16,
            m: 1
        }, // the ground knife facets at the jaw tips read darker, as in photos
        knurl: {
            c: [0.70, 0.71, 0.73],
            r: 0.46,
            m: 0.6
        },
        steel: {
            c: [0.64, 0.65, 0.67],
            r: 0.26,
            m: 1
        },
        brass: {
            c: [0.82, 0.64, 0.34],
            r: 0.34,
            m: 1
        },
        hss: {
            c: [0.34, 0.35, 0.37],
            r: 0.36,
            m: 1
        },
        zinc: {
            c: [0.70, 0.71, 0.66],
            r: 0.40,
            m: 1
        },
        iron: {
            c: [0.36, 0.37, 0.39],
            r: 0.58,
            m: 0.55
        },
        bronze: {
            c: [0.70, 0.52, 0.30],
            r: 0.40,
            m: 1
        },
        blackox: {
            c: [0.06, 0.06, 0.065],
            r: 0.32,
            m: 0.7
        },
    };
    var CUT_COL = [0.60, 0.15, 0.12];
    // One key light, raking from the upper left and a little in front: a top face reads lighter than a
    // front face, a rounded edge carries a highlight, and a cut engraving shows its lit far wall.
    var KEY_LIGHT = (function() {
        var v = [-0.62, 0.70, 0.36],
            l = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / l, v[1] / l, v[2] / l];
    })();
    // The steel parts that carry the brushed grain (their own texture); the beam front and the vernier bevel
    // carry it baked under their engraving.
    var BRUSHED = {
        beam: 1,
        plate: 1,
        fixedJaw: 1,
        fixedTip: 1,
        slideTip: 1,
        fixedBoss: 1,
        fixedNib: 1,
        slider: 1,
        slideJaw: 1,
        slideArm: 1,
        slideNib: 1,
        rollerBracket: 1,
        rod: 1
    };
    var BRUSH_MM_U = 48,
        BRUSH_MM_V = 12; // one tile of the grain texture, in mm

    /* A block with a blind round hole along +u: one closed shell. Square outer wall u0..u0+dep+fl, a
       front face with the hole in it, the bore wall to u0+dep, the hole's floor, and the back face. */
    function blindHoleBlock(g, u0, dep, fl, cy, cz, by, bz, r, N) {
        var u1 = u0 + dep + fl,
            ub = u0 + dep,
            k, sq = [],
            ci = [];
        for (k = 0; k < N; k++) {
            var t = TAU * k / N,
                c = Math.cos(t),
                s = Math.sin(t),
                sc = 1 / Math.max(Math.abs(c) / by, Math.abs(s) / bz);
            sq.push([cy + c * sc, cz + s * sc, c, s]);
            ci.push([cy + r * c, cz + r * s, c, s]);
        }
        // the square's sides: flat normals, so split per side by the dominant direction of each segment
        for (k = 0; k < N; k++) {
            var a = sq[k],
                b = sq[(k + 1) % N],
                dy = b[0] - a[0],
                dz = b[1] - a[1],
                l = Math.hypot(dy, dz) || 1;
            var ny = dz / l,
                nz = -dy / l;
            if ((a[0] + b[0] - 2 * cy) * ny + (a[1] + b[1] - 2 * cz) * nz < 0) {
                ny = -ny;
                nz = -nz;
            }
            quadFace(g, [u0, a[0], a[1]], [u0, b[0], b[1]], [u1, b[0], b[1]], [u1, a[0], a[1]], [0, ny, nz]);
            var p = ci[k],
                q = ci[(k + 1) % N];
            var i0 = g.v(u0, p[0], p[1], 0, -p[2], -p[3]),
                i1 = g.v(u0, q[0], q[1], 0, -q[2], -q[3]);
            var i2 = g.v(ub, q[0], q[1], 0, -q[2], -q[3]),
                i3 = g.v(ub, p[0], p[1], 0, -p[2], -p[3]);
            g.quad(i0, i1, i2, i3);
            quadFace(g, [u0, a[0], a[1]], [u0, b[0], b[1]], [u0, q[0], q[1]], [u0, p[0], p[1]], [-1, 0, 0]); // front face round the mouth
        }
        var c0 = g.v(ub, cy, cz, -1, 0, 0),
            f0 = g.mark(); // the floor of the hole
        for (k = 0; k < N; k++) g.v(ub, ci[k][0], ci[k][1], -1, 0, 0);
        for (k = 0; k < N; k++) g.tri(c0, f0 + k, f0 + (k + 1) % N);
        var c1 = g.v(u1, cy, cz, 1, 0, 0),
            f1 = g.mark(); // the back face
        for (k = 0; k < N; k++) g.v(u1, sq[k][0], sq[k][1], 1, 0, 0);
        for (k = 0; k < N; k++) g.tri(c1, f1 + k, f1 + (k + 1) % N);
    }
    // A depth part's drawn bore: the beam end has to bridge it, so it is never wider than 3/4 of the beam.
    function depthBore(wp) {
        return Math.min(wp.boreMm || 10, VC3D_DIM.depthBoreMax);
    }

    function buildPart(g, H, wp) {
        var D = VC3D_DIM,
            w = wp.mm,
            sh = wp.shape || 'bar',
            yc = D.partY,
            m0 = g.mark();
        if (wp.kind === 'internal') {
            var ri = w / 2,
                ro = ri + D.ringWall,
                hh = D.ringH / 2;
            var ch = 0.45; // chamfered both ends, inside and out, as a turned bush is
            revX(g, [
                [-hh, ri + ch],
                [-hh, ro - ch],
                [-hh + ch, ro],
                [hh - ch, ro],
                [hh, ro - ch],
                [hh, ri + ch],
                [hh - ch, ri],
                [-hh + ch, ri]
            ], 112, 20);
            // bush axis vertical, the bore's left wall on u = 0 (pose shifts it while the nibs are shut)
            g.xform(m0, dchain(dT(D.nibU + ri, D.ringY0 + hh, 0), dRZ(Math.PI / 2)));
            return 'bronze';
        }
        if (wp.kind === 'depth') {
            var u0 = D.beamU1,
                dep = w,
                fl = D.depthFloor,
                by = D.depthBlockY,
                bz = D.depthBlockZ,
                r = depthBore(wp) / 2;
            var cy = D.rodY,
                cz = D.rodZ,
                N = 64;
            // ONE closed shell each (the cut shader paints a shell's inside red, so two shells sharing a
            // face would z-fight inside the section).
            if (!/slot/i.test(wp.name || '')) blindHoleBlock(g, u0, dep, fl, cy, cz, by, bz, r, N);
            else prism(g, [
                [u0, cy - by],
                [u0 + dep + fl, cy - by],
                [u0 + dep + fl, cy + by],
                [u0, cy + by],
                [u0, cy + r],
                [u0 + dep, cy + r],
                [u0 + dep, cy - r],
                [u0, cy - r]
            ], cz - bz, cz + bz, null, null);
            return 'iron';
        }
        var h = wp.hMm || 20;
        if (sh === 'bar') {
            boxW(g, 0, w, yc - h / 2, yc + h / 2, -10, 10);
            return 'steel';
        }
        if (sh === 'plate') {
            boxW(g, 0, w, yc - h / 2, yc + h / 2, -14, 14);
            return 'ground';
        }
        if (sh === 'cube') {
            boxW(g, 0, w, yc - w / 2, yc + w / 2, -w / 2, w / 2);
            return 'ground';
        }
        if (sh === 'ball') {
            var R = w / 2,
                prof = [];
            for (var i = 0; i <= 36; i++) {
                var a = Math.PI * i / 36;
                prof.push([R - R * Math.cos(a), R * Math.sin(a)]);
            }
            revX(g, prof, 72, 60);
            g.xform(m0, dT(0, yc, 0));
            return 'chrome';
        }
        if (sh === 'nut') {
            var ap = w / 2,
                Rc = ap / Math.cos(Math.PI / 6),
                out = [],
                inn = [];
            for (var kk = 0; kk < 6; kk++)
                for (var ss = 0; ss < 4; ss++) {
                    var t0 = kk * Math.PI / 3 + Math.PI / 6,
                        t1 = (kk + 1) * Math.PI / 3 + Math.PI / 6,
                        f = ss / 4;
                    var y = Rc * Math.cos(t0) * (1 - f) + Rc * Math.cos(t1) * f,
                        z = Rc * Math.sin(t0) * (1 - f) + Rc * Math.sin(t1) * f;
                    out.push([y, z]);
                    var ang = Math.atan2(z, y);
                    inn.push([0.33 * w * Math.cos(ang), 0.33 * w * Math.sin(ang)]);
                }
            // flats normal to u: built about X with a vertex up, then turned so its axis faces the viewer
            ringPrismX(g, out, inn, -0.42 * w, 0.42 * w, true);
            g.xform(m0, dchain(dT(w / 2, yc, 0), dRY(-Math.PI / 2), dRX(Math.PI / 2)));
            return 'zinc';
        }
        var rr = w / 2;
        if (sh === 'cylH') { // lying down: axis along u, the jaws span its LENGTH
            revX(g, [
                [0, 0],
                [0, h / 2 - 0.3],
                [0.3, h / 2],
                [w - 0.3, h / 2],
                [w, h / 2 - 0.3],
                [w, 0]
            ], 64);
            g.xform(m0, dT(0, yc, 0));
            return 'steel';
        }
        // standing: axis vertical, the jaws close on the DIAMETER
        if (sh === 'drill') {
            var tip = rr / Math.tan(59 * D2R);
            revX(g, [
                [-h / 2, 0],
                [-h / 2 + tip, rr],
                [h / 2 - 0.3, rr],
                [h / 2, rr - 0.3],
                [h / 2, 0]
            ], 64);
        } else revX(g, [
            [-h / 2, 0],
            [-h / 2, rr - 0.3],
            [-h / 2 + 0.3, rr],
            [h / 2 - 0.3, rr],
            [h / 2, rr - 0.3],
            [h / 2, 0]
        ], 64);
        g.xform(m0, dchain(dT(rr, yc, 0), dRZ(Math.PI / 2)));
        return sh === 'drill' ? 'hss' : 'steel';
    }

    var SC_CACHE = [];

    function geomKey(H, tier) {
        var wp = H.st.wp;
        return [wp ? wp.id : '', tier].join('|');
    }
    /* Pure geometry, no GL. Geos are in each part's own frame; partMatrices places them. */
    function buildScene(H, tier) {
        var key = geomKey(H, tier);
        for (var c = 0; c < SC_CACHE.length; c++)
            if (SC_CACHE[c].key === key) return SC_CACHE[c];
        var T = K.TIERS[tier] || K.TIERS.full,
            D = VC3D_DIM,
            geos = {},
            items = [];

        function add(name, mat, opt) {
            var g = new K.Geo();
            geos[name] = g;
            var tex = (opt && opt.tex) || (BRUSHED[name] ? 'brush' : null);
            items.push({
                name: name,
                mat: mat,
                clip: !!(opt && opt.clip),
                tex: tex,
                id: (opt && opt.id) || PART_ID[name] || 0
            });
            return g;
        }
        var hb = D.beamT / 2,
            L = D.beamU1 - D.beamU0,
            gz = -hb + D.grooveZ;
        // ── beam: a front slab carrying the main scale, and the two lands either side of the rod groove
        // ONE section with the rod groove in its back, the four long edges rounded, the ends chamfered; the
        // main scale is a decal a hair proud of the front face, inside the rounded edges
        roundSolid(add('beam', 'satin'), [
                [0, -hb],
                [0, hb],
                [D.beamH, hb],
                [D.beamH, -hb],
                [D.grooveY1, -hb],
                [D.grooveY1, gz],
                [D.grooveY0, gz],
                [D.grooveY0, -hb]
            ], function(c) {
                return Math.abs(Math.abs(c[1]) - hb) < 1e-9 && (c[0] === 0 || c[0] === D.beamH) ? 0.45 : 0.15;
            },
            D.beamU0, D.beamU1, 0.3, CYC);
        decal(add('beamScale', 'satin', {
                tex: 'main',
                id: PART_ID.beam
            }), [0.55, hb], [D.beamH - 0.55, hb], [0, 1], 0.02,
            D.beamU0 + 0.4, D.beamU1 - 0.4, CYC,
            function(y, z, u) {
                return [(u - D.beamU0) / L, 1 - y / D.beamH];
            });
        // ── fixed jaws
        // the measuring face and its root relief stay sharp; every other corner of the jaw is rounded
        roundSolid(add('fixedJaw', 'satin'), jawBody(fixedJawPoly(), -1), function(c) {
            return c[0] > -0.7 || onTipLine(c, -1) ? 0 : 0.8;
        }, -hb, hb, 0.3);
        jawTip(add('fixedTip', 'lapped', {
            id: PART_ID.fixedJaw
        }), fixedJawPoly(), -1, hb);
        // the raised boss the fixed blade stands on (behind the plane of the knife edges), and the blade
        var bossU1 = bladePoly(false)[1][0];
        roundSolid(add('fixedBoss', 'satin', {
            id: PART_ID.fixedJaw
        }), [
            [D.beamU0 + 1.7, D.beamH],
            [bossU1, D.beamH],
            [bossU1, D.railTop],
            [D.beamU0 + 1.7, D.railTop]
        ], function(c) {
            return c[1] > D.beamH ? 0.5 : 0;
        }, -hb, 0, 0.15);
        bladeLoft(add('fixedNib', 'ground'), bladePoly(false), -D.nibZ, D.nibU, D.nibBevel);
        // ── slider (slider coordinates: u − mm)
        var HL = D.headLen,
            z0 = D.plateZ0,
            z1 = D.plateZ1,
            cl = D.clr;
        // the slider's body: ONE C-section wrapped round the beam with running clearance — skirt under the
        // beam, back plate, top rail and the rail's front lip — in (y, z), extruded along u
        roundSolid(add('slider', 'satin'), [
                [D.headBot, -z1],
                [D.railTop, -z1],
                [D.railTop, z1],
                [D.beamH - 1.2, z1],
                [D.beamH - 1.2, z0],
                [D.beamH + cl, z0],
                [D.beamH + cl, -z0],
                [-cl, -z0],
                [-cl, z0],
                [D.headBot, z0]
            ],
            function(c) {
                return Math.abs(c[1]) > z1 - 1e-9 ? 0.7 : 0.25;
            }, 0, HL, 0.3, CYC);
        // the vernier plate: bevelled to bring its engraved edge down onto the beam (the standoff)
        var pZe = hb + D.standoff;
        var plPoly = [
            [D.datumY, z0],
            [D.datumY, pZe],
            [D.bevelBot, z1],
            [D.headBot, z1],
            [D.headBot, z0]
        ];
        var bevL = Math.hypot(D.datumY - D.bevelBot, z1 - pZe);
        // the plate's body (the bevel's foot and the lower front edge rounded; the engraved edge stays sharp)
        // chamfer kept under the 0.15 mm top land of the engraved edge, or the inset would cross itself
        roundSolid(add('plate', 'satin'), plPoly, function(c) {
            return c[0] === D.datumY ? 0 : 0.6;
        }, -1.2, HL - 0.6, 0.06, CYC);
        // the vernier scale: a decal on the bevel, from its edge down to just short of the rounded foot
        var bd = [(D.bevelBot - D.datumY) / bevL, (z1 - pZe) / bevL],
            bn = [bd[1], -bd[0]];
        if (bn[1] < 0) bn = [-bn[0], -bn[1]];
        decal(add('plateScale', 'satin', {
                tex: 'vern',
                id: PART_ID.plate
            }), [D.datumY + bd[0] * 0.03, pZe + bd[1] * 0.03], [D.datumY + bd[0] * (bevL - 0.35), pZe + bd[1] * (bevL - 0.35)], bn, 0.02, -1.0, HL - 0.8, CYC,
            function(y, z, u) {
                var s = ((y - D.datumY) * bd[0] + (z - pZe) * bd[1]) / bevL;
                return [(u + 1.2) / (HL - 0.6 + 1.2), s];
            });
        roundSolid(add('slideJaw', 'satin'), jawBody(slideJawPoly(), 1), function(c) {
            return c[0] < 0.7 || onTipLine(c, 1) ? 0 : 0.8;
        }, -hb, hb, 0.3);
        jawTip(add('slideTip', 'lapped', {
            id: PART_ID.slideJaw
        }), slideJawPoly(), 1, hb);
        // the slider's arm, reaching left over the beam in FRONT of the plane of the knife edges, and its blade
        var armU0 = bladePoly(true)[0][0];
        roundSolid(add('slideArm', 'satin', {
                id: PART_ID.slider
            }), [
                [armU0, D.beamH + cl],
                [1.0, D.beamH + cl],
                [1.0, D.railTop],
                [armU0, D.railTop]
            ],
            function(c) {
                return c[0] < 0 ? 0.5 : 0;
            }, 0, hb, 0.15);
        bladeLoft(add('slideNib', 'ground'), bladePoly(true), D.nibZ, D.nibU, -D.nibBevel);
        // depth rod, in its groove, pinned to the slider at rodAnchor from the slider's tail
        var rt = D.rodT,
            rw = D.rodW,
            rz0 = -hb + 0.05,
            ry = D.rodY;
        var rod = add('rod', 'ground');
        roundSolid(rod, [
                [ry - rw / 2, rz0],
                [ry + rw / 2, rz0],
                [ry + rw / 2, rz0 + rt],
                [ry - rw / 2, rz0 + rt]
            ], 0.25,
            HL - D.rodAnchor, D.beamU1, 0.12, CYC);
        // the six screws that hold the slider together: three in the vernier plate's lower face, three in the
        // top of the rail (black-oxide pan heads with a slot)
        function screwHead(g, M) {
            var m0 = g.mark();
            revX(g, [
                [0, 0],
                [0, 1.15],
                [0.12, 1.15],
                [0.32, 0.9],
                [0.4, 0.5],
                [0.4, 0]
            ], 24, 30);
            boxW(g, 0.3, 0.46, -0.95, 0.95, -0.14, 0.14); // the slot, standing in the head
            g.xform(m0, M);
        }
        var ps = add('plateScrews', 'blackox', {
            id: PART_ID.plate
        });
        [4.2, 34.5, 64.6].forEach(function(u) {
            screwHead(ps, dchain(dT(u, D.headBot + 2.15, z1), dRY(-Math.PI / 2)));
        });
        var rs = add('railScrews', 'blackox', {
            id: PART_ID.slider
        });
        [4.4, 26.0, 63.5].forEach(function(u) {
            screwHead(rs, dchain(dT(u, D.railTop, 0), dRZ(Math.PI / 2)));
        });
        // locking screw on the rail (lock frame: axis +Y)
        var lk = add('lock', 'knurl'),
            lm = lk.mark();
        // a stem, a core with a chamfered crown, and a straight knurl round the head (as on the 2D nut)
        revX(lk, [
            [0, 0],
            [0, 1.1],
            [0.6, 1.1],
            [0.6, D.lockR - 0.3],
            [D.lockH - 0.45, D.lockR - 0.3],
            [D.lockH, D.lockR - 0.8],
            [D.lockH, 0]
        ], 40, 20);
        knurlRing(lk, 0.75, D.lockH - 0.5, D.lockR, D.lockR - 0.24, D.lockR - 0.55, T.knurlSeg >= 96 ? 40 : 28);
        lk.xform(lm, dRZ(Math.PI / 2));
        boxW(lk, -0.3, 0.3, D.lockH - 0.05, D.lockH + 0.35, -D.lockR + 0.6, D.lockR - 0.6); // the slot across the head
        // thumb roller under the skirt (roller frame: axis +Z)
        var rl = add('roller', 'knurl'),
            rm = rl.mark();
        knurlRing(rl, -D.rollerW / 2, D.rollerW / 2, D.rollerR, D.rollerR - 0.3, 1.0, Math.round(T.knurlSeg / 2));
        revX(rl, [
            [-D.rollerW / 2 - 0.4, 0],
            [-D.rollerW / 2 - 0.4, 1.0],
            [D.rollerW / 2 + 0.4, 1.0],
            [D.rollerW / 2 + 0.4, 0]
        ], 16);
        rl.xform(rm, dRY(-Math.PI / 2));
        var brk = add('rollerBracket', 'satin', {
            id: PART_ID.slider
        });
        roundSolid(brk, [
                [D.rollerU - 5.5, D.rollerY + 0.6],
                [D.rollerU + 5.5, D.rollerY + 0.6],
                [D.rollerU + 5.5, D.headBot],
                [D.rollerU - 5.5, D.headBot]
            ],
            function(c) {
                return c[1] < D.headBot ? 1.2 : 0;
            }, -z1, -D.rollerW / 2 - 0.6, 0.15);
        // No bench: a floor drawn in the scene turns with the camera, and an orbit then reads as the room
        // moving. The instrument stands alone on the backdrop (owner's call, 2026-10-16).
        var wp = H.st.wp;
        if (wp && typeof wp.mm === 'number') {
            var pg = new K.Geo(),
                pm = buildPart(pg, H, wp);
            geos.part = pg;
            items.push({
                name: 'part',
                mat: pm,
                clip: true,
                tex: null,
                id: PART_ID.part
            });
        }
        // Brushed steel: the grain runs along the beam (u), as a caliper is ground. Planar UVs in the part's own
        // frame (parts only slide along u, so the grain stays put on the metal as they move).
        items.forEach(function(it) {
            if (it.tex !== 'brush') return;
            var g = geos[it.name];
            for (var k = 0, q = 0; k < g.p.length; k += 3, q += 2) {
                g.u[q] = g.p[k] / BRUSH_MM_U;
                g.u[q + 1] = (g.p[k + 1] + 0.37 * g.p[k + 2]) / BRUSH_MM_V;
            }
        });
        var S = {
            key: key,
            geos: geos,
            items: items
        };
        SC_CACHE.push(S);
        if (SC_CACHE.length > 8) SC_CACHE.shift();
        return S;
    }

    /* Part placement, double precision. */
    function partMatrices(H, P) {
        var D = VC3D_DIM,
            I = dI(),
            s = dT(P.sliderU, 0, 0);
        return {
            beam: I,
            beamScale: I,
            fixedJaw: I,
            fixedTip: I,
            fixedBoss: I,
            fixedNib: I,
            slider: s,
            slideJaw: s,
            slideTip: s,
            railScrews: s,
            slideArm: s,
            slideNib: s,
            rod: s,
            rollerBracket: s,
            plate: dT(P.plateU, 0, 0),
            plateScale: dT(P.plateU, 0, 0),
            plateScrews: dT(P.plateU, 0, 0),
            roller: dchain(dT(P.sliderU + D.rollerU, D.rollerY, 0), dRZ(P.rollerAngle)),
            lock: dchain(dT(P.sliderU + D.lockU, D.railTop, 0), dRY(P.locked ? Math.PI / 2 : 0)),
            part: dT(-P.ringShift, 0, 0)
        };
    }
    /* Read the faces off the placed meshes: the gap between the outside faces, between the nib edges,
       and how far the rod tip stands past the beam end. */
    function _faces(H, M) {
        var S = buildScene(H, 'minimal');

        function ext(name, axis, mx, filt) {
            var g = S.geos[name],
                m = M[name],
                best = mx ? -Infinity : Infinity;
            for (var k = 0; k < g.p.length; k += 3) {
                var w = K.xf(m, [g.p[k], g.p[k + 1], g.p[k + 2]]);
                if (filt && !filt(w)) continue;
                best = mx ? Math.max(best, w[axis]) : Math.min(best, w[axis]);
            }
            return best;
        }
        var D = VC3D_DIM,
            face = function(w) {
                return w[1] <= D.headBot + 1e-9 && w[1] >= -D.jawFaceBot - 1e-9;
            }; // both faces' flat
        return {
            outside: ext('slideJaw', 0, false, face) - ext('fixedJaw', 0, true, face),
            inside: ext('slideNib', 0, true) - ext('fixedNib', 0, false),
            nibEdgeZ: [ext('fixedNib', 2, true), ext('slideNib', 2, false)],
            rod: ext('rod', 0, true) - D.beamU1
        };
    }

    /* ── Camera ── */
    var PRESETS = {
        reading: {
            label: 'Reading'
        },
        whole: {
            label: 'Whole',
            yaw: 0.36,
            pitch: 0.34
        },
        measure: {
            label: 'Measure'
        },
        parallax: {
            label: 'Parallax',
            eyeDeg: 14
        }
    };

    function fitDist(w, h, asp, fov) {
        var t = Math.tan(fov / 2);
        return Math.max(w / (2 * t * asp), h / (2 * t));
    }

    function vernierSpan(H) {
        return H.getVsdCount() * vcVsdMm(H);
    }
    // padL: the share of the frame's width on the left that something else covers (the contact inset);
    // the scales are framed into what is left, so the inset never sits on the MSR graduation.
    // padT and padB do the same from the top (a phone's square frame can spare the top for the inset)
    // and from the bottom (the view bar).
    function readingView(H, P, asp, padL, padT, padB) {
        padL = padL || 0;
        padT = padT || 0;
        padB = padB || 0;
        var fov = 30 * D2R,
            span = vernierSpan(H),
            u0 = P.plateU - 7,
            u1 = P.plateU + Math.max(span, 12) + 6;
        var t = Math.tan(fov / 2),
            dist = Math.max((u1 - u0) * 1.04 / (2 * t * asp * (1 - padL)), 22 * 1.04 / (2 * t * (1 - padT - padB)));
        var Wv = 2 * dist * t * asp,
            Hv = 2 * dist * t;
        return {
            yaw: 0,
            pitch: 0.06,
            fov: fov,
            dist: dist,
            target: [(u0 + u1) / 2 - padL * Wv / 2, 3.2 + (padT - padB) * Hv / 2, VC3D_DIM.beamFront]
        };
    }
    // The Measure view frames whatever is measuring: jaws on a part, the nibs from above looking down the
    // bore, or the rod in the sectioned block. With no part, the outside jaws at the current opening.
    function measureView(H, P, asp) {
        var D = VC3D_DIM,
            fov = 30 * D2R,
            wp = H.st.wp;
        if (wp && wp.kind === 'internal') {
            // The bush cut on z = 0 — the plane both knife edges lie in — so the section shows the bore's
            // diameter as the gap between two red walls and the two edges standing exactly on it.
            var cx = D.nibU + wp.mm / 2 - P.ringShift,
                R = wp.mm / 2 + D.ringWall;
            return {
                yaw: 0.0,
                pitch: 0.42,
                fov: fov,
                dist: fitDist(2 * R + 12, D.nibTip - D.beamH + 10, asp, fov),
                target: [cx, D.ringY0 - 3, 0],
                cut: 0
            };
        }
        if (wp && wp.kind === 'depth') {
            // square to the section: the block's near half cut away on the rod's own plane, the rod in the hole
            var a = D.beamU1 - 16,
                b = D.beamU1 + wp.mm + D.depthFloor + 2;
            return {
                yaw: 0.22,
                pitch: 0.16,
                fov: fov,
                dist: fitDist(b - a, 2 * D.depthBlockY + 4, asp, fov) * 1.05,
                target: [(a + b) / 2, D.rodY, D.rodZ],
                cut: D.rodZ
            };
        }
        var w = wp ? wp.mm : P.gap,
            x0 = -8,
            x1 = Math.max(w, 6) + 18;
        return {
            yaw: 0.28,
            pitch: 0.16,
            fov: fov,
            dist: fitDist(x1 - x0, 48, asp, fov),
            target: [(x0 + x1) / 2, -20, 0],
            cut: null
        };
    }
    var BOUNDS_CACHE = {};
    // World bounds of the instrument over its travel (fixed per geometry, never per reading), so the
    // Whole view never moves while the jaws do.
    function sceneBounds(H) {
        // The slider never leaves the beam, so the instrument closed (plus the part) bounds it at any
        // opening; only a depth part brings the rod into the frame, over its short travel.
        var wp = H.st.wp,
            top = wp && wp.kind === 'depth' ? H.wpMaxMm() : 0,
            key = geomKey(H, 'minimal') + '|' + top;
        if (BOUNDS_CACHE[key]) return BOUNDS_CACHE[key];
        var S = buildScene(H, 'minimal'),
            lo = [Infinity, Infinity, Infinity],
            hi = [-Infinity, -Infinity, -Infinity],
            pts = [];
        [0, top].forEach(function(mm) {
            var Hx = Object.create(H);
            Hx.st = Object.assign({}, H.st, {
                mm: mm
            });
            var M = partMatrices(Hx, vcPose(Hx));
            S.items.forEach(function(it) {
                if (it.name === 'rod' && !top) return;
                var g = S.geos[it.name],
                    m = M[it.name];
                if (!g || !m) return;
                for (var k = 0; k < g.p.length; k += 3) {
                    var w = K.xf(m, [g.p[k], g.p[k + 1], g.p[k + 2]]);
                    for (var a = 0; a < 3; a++) {
                        if (w[a] < lo[a]) lo[a] = w[a];
                        if (w[a] > hi[a]) hi[a] = w[a];
                    }
                    if ((k / 3) % 5 === 0) pts.push(w);
                }
            });
        });
        var b = {
            lo: lo,
            hi: hi,
            pts: pts,
            key: key
        };
        BOUNDS_CACHE = {};
        BOUNDS_CACHE[key] = b;
        return b;
    }

    function presetsFor(H, P, asp, opt) {
        var rv = readingView(H, P, asp, opt && opt.padL, opt && opt.padT, opt && opt.padB),
            out = {},
            only = opt && opt.only;
        var eye = ((opt && opt.eyeDeg != null) ? opt.eyeDeg : PRESETS.parallax.eyeDeg) * D2R;
        out.reading = {
            yaw: rv.yaw,
            pitch: rv.pitch,
            dist: rv.dist,
            fov: rv.fov,
            target: rv.target.slice(),
            cut: null
        };
        // The eye moves ALONG the beam, the direction parallax shifts the vernier. A raised edge seen from
        // the −u side lands on the beam displaced to +u (away from the eye), so a positive angle puts the
        // eye at −u and the apparent reading rises by standoff · tan θ.
        // Aimed at the COINCIDENT line, so "θ off square" is true where the eye is actually reading.
        var uc = P.plateU + H.getAlignedIdx() * vcVsdMm(H);
        out.parallax = {
            yaw: rv.yaw - eye,
            pitch: rv.pitch,
            dist: rv.dist,
            fov: rv.fov,
            target: [uc, rv.target[1], rv.target[2]],
            cut: null
        };
        var mv = measureView(H, P, asp);
        out.measure = {
            yaw: mv.yaw,
            pitch: mv.pitch,
            dist: mv.dist,
            fov: mv.fov,
            target: mv.target.slice(),
            cut: mv.cut
        };
        if (only && only !== 'whole') return out;
        var wv = wholeView(H, rv.fov, asp),
            pad = (opt && opt.padL) || 0,
            padT = (opt && opt.padT) || 0;
        if (pad || padT) { // frame the instrument into the part of the view the inset leaves free
            var wB = camBasis(wv, asp, 1);
            wv.dist /= (1 - Math.max(pad, padT));
            var Wv = 2 * wv.dist * wB.t * asp,
                Hv = 2 * wv.dist * wB.t;
            wv.target = K.add(wv.target, K.add(K.scl(wB.x, -pad * Wv / 2), K.scl(wB.y, padT * Hv / 2)));
        }
        out.whole = wv;
        return out;
    }
    // The Whole view, fitted to the instrument's real silhouette (a sample of its vertices, not its bounding
    // box, which a long thin beam seen at a yaw overstates by half). Cached per geometry and aspect.
    var WHOLE_CACHE = {};

    function wholeView(H, fov, asp) {
        var b = sceneBounds(H),
            key = b.key + '|' + asp.toFixed(3);
        if (WHOLE_CACHE[key]) return Object.assign({}, WHOLE_CACHE[key], {
            target: WHOLE_CACHE[key].target.slice()
        });
        var c = [0, 1, 2].map(function(a) {
            return (b.lo[a] + b.hi[a]) / 2;
        });
        var r = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) / 2;
        var w = {
            yaw: PRESETS.whole.yaw,
            pitch: PRESETS.whole.pitch,
            dist: r / Math.sin(fov / 2),
            fov: fov,
            target: c,
            cut: null
        };
        for (var it = 0; it < 8; it++) {
            var B = camBasis(w, asp, 1),
                x0 = Infinity,
                x1 = -Infinity,
                y0 = Infinity,
                y1 = -Infinity;
            b.pts.forEach(function(p) {
                var q = project(B, p);
                x0 = Math.min(x0, q.x);
                x1 = Math.max(x1, q.x);
                y0 = Math.min(y0, q.y);
                y1 = Math.max(y1, q.y);
            });
            // re-centre on the silhouette, then stand off so it fills 88 % of the frame
            var cx = (x0 + x1) / 2 - asp / 2,
                cy = (y0 + y1) / 2 - 0.5,
                k = 2 * w.dist * B.t;
            w.target = K.add(w.target, K.add(K.scl(B.x, cx * k), K.scl(B.y, -cy * k)));
            var ext = Math.max((x1 - x0) / asp, (y1 - y0)) / 0.88;
            w.dist *= Math.max(0.5, Math.min(2, ext));
        }
        WHOLE_CACHE = {};
        WHOLE_CACHE[key] = w;
        return Object.assign({}, w, {
            target: w.target.slice()
        });
    }

    /* Parallax: the vernier's engraved edge stands `standoff` off the beam, so an eye θ off square sees
       it land standoff · tan θ along the beam from where it really is. */
    function parallaxShift(s, th) {
        return s * Math.tan(th);
    }

    function parallaxReading(H, P, th) {
        var lc = H.getLcMm(),
            tru = H.getQuantMm(),
            sh = parallaxShift(VC3D_DIM.standoff, th);
        var app = Math.max(0, Math.min(H.getMaxMm(), H.snapToLc(tru + sh)));
        return {
            trueMm: tru,
            apparentMm: app,
            divisionsOff: Math.round((app - tru) / lc)
        };
    }
    var PAR_WARN = 'Reading from an angle — your reading will be off.';

    function parallaxPlan(H, P, deg, reveal) {
        if (!reveal) return {
            kind: 'warn',
            text: PAR_WARN
        };
        var r = parallaxReading(H, P, deg * D2R),
            n = Math.abs(r.divisionsOff),
            u = H.uLabel();
        return {
            kind: 'plate',
            text: 'Eye ' + deg + '° off square · you read ' + H.fmtReading(r.apparentMm) + ' ' + u +
                ' · square-on ' + H.fmtReading(r.trueMm) + ' ' + u + ' · ' + n + ' division' + (n === 1 ? '' : 's') + ' off'
        };
    }

    function wrapPi(a) {
        return K.mod(a + Math.PI, TAU) - Math.PI;
    }

    function camStep(c, t, dt) {
        var k = 1 - Math.exp(-K.clampDt(dt) / 120);
        if (k <= 0) return c;
        return {
            yaw: c.yaw + wrapPi(t.yaw - c.yaw) * k,
            pitch: c.pitch + (t.pitch - c.pitch) * k,
            dist: c.dist + (t.dist - c.dist) * k,
            fov: t.fov || c.fov,
            target: [0, 1, 2].map(function(i) {
                return c.target[i] + (t.target[i] - c.target[i]) * k;
            })
        };
    }

    function camSettled(c, t) {
        return Math.abs(wrapPi(t.yaw - c.yaw)) < 1e-4 && Math.abs(t.pitch - c.pitch) < 1e-4 &&
            Math.abs(t.dist - c.dist) < 1e-3 * t.dist &&
            Math.hypot(t.target[0] - c.target[0], t.target[1] - c.target[1], t.target[2] - c.target[2]) < 1e-3;
    }

    function camBasis(view, w, h) {
        var e = K.orbitEye(view.target, view.yaw, view.pitch, view.dist);
        var z = K.nrm(K.sub(e, view.target)),
            x = K.nrm(K.cross([0, 1, 0], z)),
            y = K.cross(z, x);
        return {
            e: e,
            x: x,
            y: y,
            z: z,
            w: w,
            h: h,
            t: Math.tan((view.fov || 30 * D2R) / 2)
        };
    }

    function project(B, p) {
        var d = K.sub(p, B.e),
            cx = K.dot(B.x, d),
            cy = K.dot(B.y, d),
            depth = -K.dot(B.z, d),
            k = B.h / (2 * depth * B.t);
        return {
            x: B.w / 2 + cx * k,
            y: B.h / 2 - cy * k,
            depth: depth,
            k: k
        };
    }
    /* Where the slider moves on screen per mm of opening: dir is a unit screen vector, pxPerMm the scale. */
    function dragAxis(H, P, view, w, h) {
        var B = camBasis(view, w, h),
            p0 = [P.sliderU + 30, -4, VC3D_DIM.plateZ1];
        var a = project(B, p0),
            b = project(B, [p0[0] + 1, p0[1], p0[2]]);
        var s = [b.x - a.x, b.y - a.y],
            sl = Math.hypot(s[0], s[1]);
        return {
            dir: sl > 1e-9 ? [s[0] / sl, s[1] / sl] : [1, 0],
            pxPerMm: Math.max(sl, 0.05),
            at: [a.x, a.y]
        };
    }
    /* A drag of `along` CSS px: the head follows the pointer at pxPerMm; on the thumb roller one least
       count per FINE_PX, the 2D roller's gain (WHEEL_PX_PER_LC). */
    var FINE_PX = 3,
        PINCH_UNDO_MS = 400;
    /* Least counts for one wheel event over the slider. A mouse NOTCH (one event of 50 px or more, or a line
       or page step) is exactly one; a trackpad's two-finger scroll is a stream of small deltas, summed so a
       least count is taken per WHEEL_NOTCH px of travel and a light brush moves nothing. */
    var WHEEL_NOTCH = 100;

    function wheelSteps(E, e) {
        var dy = e.deltaY;
        if (e.deltaMode || Math.abs(dy) >= 50) {
            E.wheelAcc = 0;
            return dy > 0 ? 1 : (dy < 0 ? -1 : 0);
        }
        E.wheelAcc = (E.wheelAcc || 0) + dy;
        var st = E.wheelAcc > 0 ? Math.floor(E.wheelAcc / WHEEL_NOTCH) : Math.ceil(E.wheelAcc / WHEEL_NOTCH);
        E.wheelAcc -= st * WHEEL_NOTCH;
        return st;
    }

    function mmFromDrag(along, ax, fine, lc) {
        return fine ? Math.round(along / FINE_PX) * lc : along / ax.pxPerMm;
    }

    /* ── Engraved scales (browser only). Ink on a transparent ground, painted in millimetres. ── */
    var INK = 'rgba(14,15,17,1)',
        FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
    // A seeded generator, so the grain is the same on every load (and in every tier).
    function rng(seed) {
        return function() {
            seed |= 0;
            seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    /* Brushed grain: long fine streaks along u, lighter and darker than the steel, on a faint base. Drawn on a
       texture whose alpha mixes it INTO the material (the kit's shader: albedo → texture by alpha), so the
       metal stays metal between streaks. pxPerMmV sets how many streaks a millimetre of height holds. */
    function brushStrokes(x, W, Hh, pxPerMmV, seed, wrap) {
        var r = rng(seed),
            n = Math.round(Hh / pxPerMmV * 22);
        x.save();
        x.fillStyle = 'rgba(196,200,207,0.22)';
        x.fillRect(0, 0, W, Hh);
        for (var i = 0; i < n; i++) {
            var y = r() * Hh,
                len = W * (0.25 + 0.75 * r()),
                x0 = r() * W,
                g = Math.round(95 + 160 * r()),
                a = 0.10 + 0.36 * r();
            x.fillStyle = 'rgba(' + g + ',' + g + ',' + Math.min(255, g + 6) + ',' + a.toFixed(3) + ')';
            var th = Math.max(1, pxPerMmV * (0.012 + 0.03 * r()));
            x.fillRect(x0, y, len, th);
            if (wrap && x0 + len > W) x.fillRect(x0 - W, y, len, th);
        }
        x.restore();
    }

    function paintBrushTex(H, W, Hh) {
        var c = document.createElement('canvas');
        c.width = W;
        c.height = Hh;
        brushStrokes(c.getContext('2d'), W, Hh, Hh / BRUSH_MM_V, 9137, true);
        return c;
    }
    /* An engraved line: cut into the steel and filled black. Light comes from the upper left, so the far
       (right, lower) wall of the cut catches it — a thin bright lip beside the black. */
    function engraveRect(x, X0, Y0, w, h, lip) {
        x.fillStyle = 'rgba(255,255,255,0.7)';
        x.fillRect(X0 + w * 0.92, Y0 + lip, Math.max(1, lip), h);
        x.fillStyle = 'rgba(0,0,0,0.35)';
        x.fillRect(X0 - Math.max(1, lip * 0.6), Y0, Math.max(1, lip * 0.6), h);
        x.fillStyle = INK;
        x.fillRect(X0, Y0, w, h);
    }

    function engraveText(x, txt, lip) {
        var f = x.fillStyle;
        x.fillStyle = 'rgba(255,255,255,0.65)';
        x.fillText(txt, lip, lip);
        x.fillStyle = 'rgba(0,0,0,0.3)';
        x.fillText(txt, -lip * 0.6, -lip * 0.6);
        x.fillStyle = f;
        x.fillText(txt, 0, 0);
    }

    function paintMainTex(H, W, Hh) {
        var c = document.createElement('canvas');
        c.width = W;
        c.height = Hh;
        var x = c.getContext('2d'),
            D = VC3D_DIM,
            L = D.beamU1 - D.beamU0,
            kx = W / L,
            ky = Hh / D.beamH;
        var ppm = H.getPxPerMm();

        function X(u) {
            return (u - D.beamU0) * kx;
        }

        function Y(y) {
            return (D.beamH - y) * ky;
        }
        brushStrokes(x, W, Hh, ky, 4127, false);
        var lip = Math.max(1, 0.05 * kx);
        x.fillStyle = INK;
        x.textAlign = 'center';
        x.textBaseline = 'alphabetic';
        var marks = vcMainMarks(H);
        marks.forEach(function(m) {
            var w = Math.max(0.09, Math.min(0.17, m.wPx / ppm * 0.6)) * kx;
            engraveRect(x, X(m.u) - w / 2, Y(D.datumY + m.len), w, m.len * ky, lip);
            if (m.label !== null) {
                var cap = m.fontPx / ppm * 0.78; // the 2D numeral's height, in mm on the beam
                x.save();
                x.translate(X(m.u), Y(D.datumY + 4.23 + 0.55));
                x.scale(kx / ky, 1);
                x.font = (m.bold ? '700 ' : '600 ') + (cap * ky * 1.32) + 'px ' + FONT;
                x.fillStyle = INK;
                engraveText(x, m.label, lip * ky / kx);
                x.restore();
            }
        });
        // the maker's engraving on the run-out, past capacity — as on the 2D beam
        var cap2 = H.getMaxMm(),
            wm = (cap2 + D.beamU1) / 2;
        x.save();
        x.translate(X(wm), Y(8.2));
        x.scale(kx / ky, 1);
        x.font = 'italic 700 ' + (2.2 * ky) + 'px Georgia, "Times New Roman", serif';
        x.fillStyle = 'rgba(40,46,56,0.62)';
        x.fillText('mechsimulator.com', 0, 0);
        x.restore();
        x.save();
        x.translate(X(wm), Y(4.6));
        x.scale(kx / ky, 1);
        x.font = '600 ' + (1.25 * ky) + 'px ' + FONT;
        x.fillStyle = 'rgba(40,46,56,0.55)';
        x.fillText(H.isImperial() ? '0 – 4 in' : '0 – 100 mm', 0, 0);
        x.restore();
        return c;
    }

    function paintVernTex(H, W, Hh) {
        var c = document.createElement('canvas');
        c.width = W;
        c.height = Hh;
        var x = c.getContext('2d'),
            D = VC3D_DIM,
            uA = -1.2,
            uB = D.headLen - 0.6,
            L = uB - uA;
        var bevL = Math.hypot(D.datumY - D.bevelBot, D.plateZ1 - (D.beamFront + D.standoff));
        var kx = W / L,
            ky = Hh / bevL,
            ppm = H.getPxPerMm();

        function X(du) {
            return (du - uA) * kx;
        }
        brushStrokes(x, W, Hh, ky, 7741, false);
        var lip = Math.max(1, 0.05 * kx);
        x.fillStyle = INK;
        x.textAlign = 'center';
        x.textBaseline = 'top';
        vcVernierMarks(H).forEach(function(m) {
            var w = Math.max(0.09, Math.min(0.15, m.wPx / ppm * 0.6)) * kx;
            engraveRect(x, X(m.du) - w / 2, 0, w, m.len * ky, lip);
            if (m.label !== null) {
                x.save();
                x.translate(X(m.du), (1.92 + 0.45) * ky);
                x.scale(kx / ky, 1);
                x.font = '600 ' + (1.55 * ky * 1.32) + 'px ' + FONT;
                x.fillStyle = INK;
                engraveText(x, m.label, lip * ky / kx);
                x.restore();
            }
        });
        // the least count, engraved at the plate's right end as on a real plate
        x.save();
        x.translate(X(D.headLen - 7.5), 3.4 * ky);
        x.scale(kx / ky, 1);
        x.font = '700 ' + (1.7 * ky * 1.32) + 'px ' + FONT;
        x.fillText(H.isImperial() ? (H.impFractional() ? '1/128 in' : '.001 in') : (H.fmtLc() + ' mm'), 0, 0);
        x.restore();
        return c;
    }

    /* ── Show Me How in 3D: a pure plan of what the walkthrough shows NOW, read from the tool's own
       teach state ([VC-TEACH]). Nothing here keeps time; app.js's teachTick does. Anchors are WORLD
       points. ── */
    function clamp01(v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    // A point on the beam face above the datum, and one on the vernier bevel s mm down from its edge.
    function beamPt(u, y) {
        return [u, y, VC3D_DIM.beamFront + 0.02];
    }

    function bevelPt(u, s) {
        var D = VC3D_DIM,
            z0 = D.beamFront + D.standoff,
            bevL = Math.hypot(D.datumY - D.bevelBot, D.plateZ1 - z0);
        var f = s / bevL;
        return [u, D.datumY + (D.bevelBot - D.datumY) * f, z0 + (D.plateZ1 - z0) * f + 0.02];
    }

    function teachCamera(H, P, key, asp) {
        var fov = 30 * D2R,
            vsd = vcVsdMm(H),
            a = H.getAlignedIdx(),
            msrU = H.teachMsrDivs() * H.getMsdMm();
        if (key === 'msr') {
            var u0 = Math.min(msrU, P.plateU) - 6,
                u1 = Math.max(msrU, P.plateU) + 10;
            return {
                yaw: 0,
                pitch: 0.05,
                fov: fov,
                dist: fitDist(u1 - u0, 20, asp, fov),
                target: [(u0 + u1) / 2, 3.5, VC3D_DIM.beamFront]
            };
        }
        if (key === 'coin' || key === 'vsr') {
            var c0 = Math.min(msrU, P.plateU) - 4,
                c1 = P.plateU + (a + 1) * vsd + 5;
            return {
                yaw: 0,
                pitch: 0.05,
                fov: fov,
                dist: fitDist(c1 - c0, 18, asp, fov),
                target: [(c0 + c1) / 2, 2.6, VC3D_DIM.beamFront]
            };
        }
        return {
            preset: 'reading'
        };
    }

    function teachPlan3d(H, P, asp) {
        if (!H.teachOn || !H.teachOn()) return null;
        var at = H.teachAt(),
            key = at.key,
            i = at.i,
            D = VC3D_DIM,
            C = H.TEACH;
        var ph = H.teach && H.teach.reduced ? 1 : H.teachEase(at.phase);
        var vsd = vcVsdMm(H),
            n = H.getVsdCount(),
            a = H.getAlignedIdx(),
            zero = P.plateU,
            u = H.uLabel();
        var msrDivs = H.teachMsrDivs(),
            msrU = msrDivs * H.getMsdMm(),
            items = [];
        var marks = vcMainMarks(H),
            mk = marks[msrDivs] || {
                len: 2.5
            };
        var cap = H.teachCaption ? H.teachCaption() : ['', ''];
        if (key === 'msr' || i > 0) {
            var done = key !== 'msr',
                grow = done ? 1 : H.teachGrowFrac(at);
            items.push({
                kind: 'msrLine',
                anchor: beamPt(0, D.datumY + 0.55),
                anchor2: beamPt(zero * grow, D.datumY + 0.55),
                done: done
            });
            if (done || grow >= 1 - 1e-9) items.push({
                kind: 'indexLine',
                anchor: bevelPt(zero, 1.4),
                anchor2: beamPt(zero, D.datumY + 5.6)
            });
            if (done || zero * grow >= msrU) {
                var told = done || at.phase >= C.MSR_VALUE_AT;
                items.push({
                    kind: 'msrLeader',
                    anchor: beamPt(msrU, D.datumY + 0.15),
                    told: told,
                    text: told ? 'MSR = ' + H.fmtMsr() + ' ' + u : 'read the main scale here'
                });
            }
        }
        if (key === 'coin') {
            var scanPh = clamp01(ph / C.SCAN_TO),
                settled = ph >= C.SCAN_TO,
                upto = H.teachScanExtent(scanPh, a, n);
            for (var j = 0; j <= upto; j++) {
                var hit = j === a;
                items.push({
                    kind: 'vline',
                    state: hit ? 'match' : 'reject',
                    j: j,
                    faint: j !== upto,
                    anchor: bevelPt(zero + j * vsd, 0.1),
                    anchor2: bevelPt(zero + j * vsd, 1.5)
                });
            }
            if (settled) items.push({
                kind: 'collinear',
                anchor: beamPt(zero + a * vsd, D.datumY + 4.2),
                anchor2: bevelPt(zero + a * vsd, 1.9)
            });
            var msdD = H.getMsdDisplay(),
                miss = (a - upto) * H.getLcDisplay();
            miss -= Math.round(miss / msdD) * msdD;
            var tx = settled || upto === a ? 'this one lines up' : 'no — off by ' + H.fmtDispValue(Math.abs(miss)) + ' ' + u;
            items.push({
                kind: 'chip',
                anchor: bevelPt(zero + (settled ? a : upto) * vsd, 3.6),
                text: tx,
                col: settled || upto === a ? '#FFD700' : '#ff8f8f'
            });
        }
        var counted = null;
        if (key === 'vsr' || i > 2) {
            counted = H.teachCounted();
            for (var c = 1; c <= counted; c++) items.push({
                kind: 'vline',
                state: 'count',
                j: c,
                anchor: bevelPt(zero + c * vsd, 0.1),
                anchor2: bevelPt(zero + c * vsd, 1.4)
            });
            items.push({
                kind: 'marker',
                anchor: bevelPt(zero + counted * vsd, 0.05)
            });
            items.push({
                kind: 'chip',
                anchor: bevelPt(zero + counted * vsd, 3.4),
                text: counted + (counted === 1 ? ' division' : ' divisions'),
                col: '#FFD700'
            });
            items.push({
                kind: 'chip2',
                anchor: bevelPt(zero + counted * vsd, 6.4),
                text: H.fmtDispValue(counted * H.getLcDisplay()) + ' ' + u,
                col: '#81c784'
            });
        }
        if (key === 'tr' || key === 'ze') {
            items.push({
                kind: 'pulse',
                anchor: bevelPt(zero + a * vsd, 0.3)
            });
            items.push({
                kind: 'plate',
                text: key === 'tr' ?
                    'TR = ' + H.fmtMsr() + ' + (' + a + ' × ' + H.fmtLc() + ') = ' + H.fmtTr() + ' ' + u :
                    'Corrected = ' + H.fmtTr() + ' − (' + H.fmtZeSigned() + ') = ' + H.fmtReading(H.st.mm) + ' ' + u
            });
        }
        var tt = H.teach || null,
            nn = tt && tt.stages ? tt.stages.length : 0;
        return {
            stage: key,
            i: i,
            phase: at.phase,
            caption: cap,
            camera: teachCamera(H, P, key, asp || 2.2),
            msrU: msrU,
            counted: counted,
            items: items,
            step: nn ? (i + 1) + ' / ' + nn : '',
            progress: tt && tt.total ? clamp01(tt.t / tt.total) : 0
        };
    }

    /* Labels: where each part's name points from (world, at the current pose). */
    var LABEL_NAMES = {
        beam: 'Main scale (beam)',
        plate: 'Vernier scale',
        fixedJaw: 'Fixed jaw',
        slideJaw: 'Sliding jaw',
        slideNib: 'Inside jaws (knife edges)',
        rod: 'Depth rod',
        lock: 'Locking screw',
        roller: 'Thumb roller',
        slider: 'Slider'
    };

    function labelAnchors(H, P) {
        var D = VC3D_DIM,
            f = D.beamFront,
            sU = P.sliderU;
        var loc = {
            beam: [Math.min(D.beamU1 - 10, sU + D.headLen + 12), 12, f],
            plate: [P.plateU + 30, -3, D.plateZ1],
            fixedJaw: [-5, -26, f],
            slideJaw: [sU + 5, -26, f],
            slideNib: [sU + D.nibU - 1.2, D.ringY0, 0.8],
            rod: [D.beamU1 + Math.max(2, P.gap * 0.5), D.rodY, D.rodZ],
            lock: [sU + D.lockU, D.railTop + D.lockH, 0],
            roller: [sU + D.rollerU, D.rollerY - D.rollerR + 0.5, 1.4],
            slider: [sU + 64, 12, D.plateZ1]
        };
        var out = [];
        Object.keys(LABEL_NAMES).forEach(function(n) {
            if (n === 'rod' && P.gap < 3) return; // a rod flush with the beam end has nothing to point at
            out.push({
                part: n,
                id: PART_ID[n],
                text: LABEL_NAMES[n],
                anchor: loc[n]
            });
        });
        return out;
    }
    /* Contact and measuring annotations. Contact is not the answer and always shows; a VALUE does not
       exist in the plan until revealAllowed(). */
    function contactPlan(H, P, view) {
        var D = VC3D_DIM,
            wp = H.st.wp,
            out = [],
            on = H.wpInContact(),
            open = !!H.revealAllowed(),
            u = H.uLabel();
        if (!wp) return out;
        // a value is a dimension line: drawn where the jaws are in shot (Whole, Measure), never at a gap of nothing
        var val = open && (view === 'whole' || view === 'measure') && P.gap >= 1.5 ? H.fmtReading(H.getDisplayMm()) + ' ' + u : null;
        if (wp.kind === 'internal') {
            // the two knife edges where they touch the bore: lines on z = 0, the diameter's plane
            var ya = D.ringY0 + 0.6,
                yb = D.ringY0 + D.ringH - 0.6;
            out.push({
                kind: 'contact',
                on: on,
                anchor: [D.nibU, ya, 0],
                anchor2: [D.nibU, yb, 0]
            });
            out.push({
                kind: 'contact',
                on: on,
                anchor: [D.nibU + P.gap, ya, 0],
                anchor2: [D.nibU + P.gap, yb, 0]
            });
            if (val) {
                out.push({
                    kind: 'dim',
                    side: 'above',
                    anchor: [D.nibU, D.nibTip + 1.5, 0],
                    anchor2: [D.nibU + P.gap, D.nibTip + 1.5, 0],
                    text: 'inside jaws ' + val
                });
                if (view === 'whole') out.push({
                    kind: 'dim',
                    side: 'right',
                    anchor: [0, -D.jawDepth - 2.5, 0],
                    anchor2: [P.gap, -D.jawDepth - 2.5, 0],
                    text: 'outside jaws ' + val + ' \u2014 the same scale'
                });
            }
        } else if (wp.kind === 'depth') {
            out.push({
                kind: 'contact',
                on: on,
                anchor: [P.rodTipU, D.rodY - D.rodW / 2, D.rodZ],
                anchor2: [P.rodTipU, D.rodY + D.rodW / 2, D.rodZ]
            });
            out.push({
                kind: 'datum',
                anchor: [D.beamU1, -2, D.beamFront],
                anchor2: [D.beamU1, D.beamH + 2, D.beamFront]
            });
            // drawn above the block, clear of the beam end and the section
            var dy2 = D.rodY + D.depthBlockY + 2.5;
            if (val) out.push({
                kind: 'dim',
                side: 'above',
                anchor: [D.beamU1, dy2, D.rodZ],
                anchor2: [P.rodTipU, dy2, D.rodZ],
                text: 'depth ' + val
            });
        } else {
            out.push({
                kind: 'contact',
                on: on,
                anchor: [0, -12, D.beamFront],
                anchor2: [0, -35, D.beamFront]
            });
            out.push({
                kind: 'contact',
                on: on,
                anchor: [P.gap, -12, D.beamFront],
                anchor2: [P.gap, -35, D.beamFront]
            });
            if (val) out.push({
                kind: 'dim',
                side: 'right',
                anchor: [0, -D.jawDepth - 2.5, 0],
                anchor2: [P.gap, -D.jawDepth - 2.5, 0],
                text: val
            });
        }
        return out;
    }
    // The coincident pair, in gold. Only when the visitor has the Coincidence aid on AND the reading may
    // be shown: in Practice and Quiz it would BE the answer.
    function coincidencePlan(H, P) {
        if (!H.st.showAlign || !H.revealAllowed()) return null;
        var a = H.getAlignedIdx(),
            vsd = vcVsdMm(H),
            uu = P.plateU + a * vsd,
            D = VC3D_DIM;
        return {
            kind: 'gold',
            anchor: beamPt(uu, D.datumY + 4.23),
            anchor2: bevelPt(uu, 1.9),
            j: a
        };
    }
    /* The HUD as ONE pure list. Nothing that gives the reading away exists in it until the attempt is
       marked: reading chip, gold coincidence, dimension values, parallax plate, labels, walkthrough. */
    function hudPlan(H, P, E) {
        var items = [],
            open = !!H.revealAllowed(),
            T = open ? teachPlan3d(H, P, E.asp) : null;
        if (open && !T) items.push({
            kind: 'reading',
            text: 'Reading ' + H.fmtReading(H.getDisplayMm()) + ' ' + H.uLabel(),
            anchor: null
        });
        if (!T) {
            var g = coincidencePlan(H, P);
            if (g) items.push(g);
            contactPlan(H, P, E.view).forEach(function(c) {
                items.push(c);
            });
        }
        if (E.parallax && !T) {
            var deg = E.eyeDeg != null ? E.eyeDeg : 0,
                pl = parallaxPlan(H, P, deg, open);
            items.push({
                kind: pl.kind === 'plate' ? 'parallaxPlate' : 'warn',
                text: pl.text,
                anchor: null
            });
        }
        if (E.labels && open && !T) labelAnchors(H, P).forEach(function(l) {
            items.push({
                kind: 'label',
                text: l.text,
                part: l.part,
                id: l.id,
                anchor: l.anchor
            });
        });
        if (T) {
            items.push({
                kind: 'caption',
                title: T.caption[0],
                text: T.caption[1],
                step: T.step,
                progress: T.progress,
                anchor: null
            });
            if (E.camArrived) T.items.forEach(function(it) {
                items.push(it);
            });
        }
        return items;
    }
    // The contact inset: shown whenever a part is loaded and the main view is not already the Measure view.
    function insetWanted(H, E) {
        return !!H.st.wp && E.inset && E.view !== 'measure' && !(H.teachOn && H.teachOn());
    }

    function insetPadFor(on, W, Ht) {
        if (!on) return {
            l: 0,
            t: 0
        };
        var r = insetRect(W, Ht);
        if (W / Ht < 1.4) return {
            l: 0,
            t: Math.min(0.55, (r.y + r.h + 26) / (Ht || 1))
        };
        return {
            l: Math.min(0.5, (r.x + r.w + 8) / (W || 1)),
            t: 0
        };
    }

    function insetRect(W, Ht) {
        var w = Math.round(Math.max(150, Math.min(260, W * (W < 560 ? 0.42 : 0.28)))),
            h = Math.round(w * 0.72);
        return {
            x: 10,
            y: 12,
            w: w,
            h: h
        };
    }

    function create(H) {
        var E = {
            H: H,
            frameMs: [],
            gov: null,
            on: false,
            mounted: false,
            failed: false,
            stage: null,
            gl: null,
            hud: null,
            R: null,
            tier: 'full',
            sceneKey: '',
            items: [],
            meshes: {},
            tex: {},
            parallax: false,
            labels: false,
            inset: false,
            cam: null,
            view: 'reading',
            free: false,
            eyeDeg: PRESETS.parallax.eyeDeg,
            asp: 923 / 379,
            cssW: 1,
            cssH: 1,
            ptrs: {},
            slide: null,
            orbit: null,
            pinch: null,
            raf: 0,
            t: 0,
            drawSerial: 0,
            pickSerial: -1,
            bar: null,
            freezeP: null
        };

        function teachRunning() {
            return !!(H.teachOn && H.teachOn());
        }
        // A running walkthrough owns the camera (each stage frames itself); afterwards the camera eases back.
        // While a hand is on the slider the camera does not follow it: the part under the finger stays there.
        function camTarget() {
            var P = E.freezeP || vcPose(H),
                T = teachRunning() ? teachPlan3d(H, P, E.asp) : null;
            if (T && !T.camera.preset) return T.camera;
            if (!T && E.returnCam) return E.returnCam;
            var v = T ? T.camera.preset : E.view;
            var pd = insetPad();
            var bh = E.bar && E.bar.offsetHeight ? (E.bar.offsetHeight + 14) / (E.cssH || 1) : 0;
            return presetsFor(H, P, E.asp, {
                eyeDeg: E.eyeDeg,
                only: v,
                padL: pd.l,
                padT: pd.t,
                padB: Math.min(0.3, bh)
            })[v];
        }
        // The share of the frame the inset covers, when it is up: from the left on a wide stage, from the top on
        // a square one (a phone), where giving up half the width would shrink the scales to nothing.
        function insetPad() {
            return insetPadFor(insetWanted(H, E), E.cssW, E.cssH);
        }

        function camNear(c, t) {
            return !!c && Math.abs(wrapPi(t.yaw - c.yaw)) < 0.01 && Math.abs(t.pitch - c.pitch) < 0.01 && Math.abs(t.dist - c.dist) < 1 &&
                Math.hypot(t.target[0] - c.target[0], t.target[1] - c.target[1], t.target[2] - c.target[2]) < 1;
        }

        function syncTeach() {
            var on = teachRunning();
            if (on && !E.teachSaved) {
                E.teachSaved = {
                    free: E.free,
                    cam: E.cam ? copyCam(E.cam) : null
                };
                E.free = false;
                E.returnCam = null;
            } else if (!on && E.teachSaved) {
                var sv = E.teachSaved;
                E.teachSaved = null;
                E.teachKey = null;
                E.free = false;
                E.returnCam = sv.free && sv.cam ? sv.cam : null;
                E.returnFree = !!sv.free;
                syncBar();
                kick();
            }
            if (on) {
                var key = H.teachAt().key;
                if (key !== E.teachKey) {
                    E.teachKey = key;
                    E.free = false;
                    kick();
                }
            }
        }
        // cut: the z of the section plane (parts only), or null
        function copyCam(c) {
            return {
                yaw: c.yaw,
                pitch: c.pitch,
                dist: c.dist,
                fov: c.fov,
                target: c.target.slice(),
                cut: c.cut == null ? null : c.cut
            };
        }

        function camBusy() {
            return !E.free && E.cam && !camSettled(E.cam, camTarget());
        }

        function busy() {
            return !!(E.slide || E.orbit || E.pinch) || camBusy() || !!E.labelsDeferred || hudAnimating();
        }

        function hudAnimating() {
            return (E.hudItems || []).some(function(it) {
                return it.kind === 'pulse';
            });
        }

        function nowMs() {
            return typeof performance !== 'undefined' ? performance.now() : 0;
        }
        var LABEL_QUIET = 150;
        // Labels need a gl.readPixels of the id map: never while anything moves. Read once, after it stops.
        function labelsReady() {
            return !E.orbit && !E.pinch && !E.slide && !camBusy() && nowMs() - (E.poseT || 0) >= LABEL_QUIET;
        }

        function stopLoop() {
            if (E.raf > 0) cancelAnimationFrame(E.raf);
            E.raf = 0;
        }
        /* The ONE place a frame is armed. E.raf is non-zero from arming until tick has finished (−1 while
           tick runs), so the render tick triggers cannot arm a second frame. */
        function kick(keepClock) {
            if (E.raf || !E.on || E.failed || typeof requestAnimationFrame === 'undefined') return;
            if (!keepClock) E.t = performance.now();
            E.raf = requestAnimationFrame(tick);
        }

        function tick(now) {
            E.raf = -1;
            try {
                if (!E.on) return;
                var dt = K.clampDt(now - E.t),
                    changed = false;
                E.t = now;
                if (!E.free && E.cam) {
                    var tg = camTarget();
                    if (camSettled(E.cam, tg)) {
                        if (JSON.stringify(E.cam) !== JSON.stringify(copyCam(tg))) {
                            E.cam = copyCam(tg);
                            changed = true;
                        }
                    } else {
                        E.cam = camStep(E.cam, tg, dt);
                        E.cam.cut = tg.cut == null ? null : tg.cut;
                        changed = true;
                    }
                    if (E.returnCam && !teachRunning() && camSettled(E.cam, tg)) {
                        E.free = E.returnFree;
                        E.returnCam = null;
                    }
                }
                if (E.labelsDeferred && labelsReady()) changed = true;
                if (hudAnimating()) changed = true;
                if (changed) H.render();
            } finally {
                if (E.raf === -1) E.raf = 0;
                var again;
                try {
                    again = busy();
                } catch (err) {
                    again = true;
                }
                if (again) kick(true);
            }
        }
        /* ── HUD: the ONE painter of hudPlan. ── */
        var BAND_H = 58,
            BAND_PAD = 10,
            ID_DIV = 3;

        function stageRect(el) {
            if (!el || el.hidden || !E.stage || !el.getBoundingClientRect) return null;
            var a = el.getBoundingClientRect(),
                b = E.stage.getBoundingClientRect();
            if (!a.width || !a.height) return null;
            return {
                x: a.left - b.left,
                y: a.top - b.top,
                w: a.width,
                h: a.height
            };
        }

        function chip(x, k, px, py, txt, col, align, maxW, fill) {
            x.save();
            x.font = '600 ' + 12 * k + "px 'Segoe UI', system-ui, sans-serif";
            x.textBaseline = 'middle';
            var tw = Math.min(x.measureText(txt).width, (maxW || 1e9) * k),
                w = tw + 14 * k,
                h = 20 * k;
            var lx = align === 'right' ? px * k - w : (align === 'center' ? px * k - w / 2 : px * k);
            lx = Math.max(4 * k, Math.min(lx, E.hud.width - w - 4 * k));
            var ly = Math.max(4 * k, Math.min(py * k - h / 2, (E.hudFloor || E.hud.height / k) * k - h - 4 * k));
            x.fillStyle = fill || 'rgba(10,16,24,0.88)';
            x.beginPath();
            if (x.roundRect) x.roundRect(lx, ly, w, h, 6 * k);
            else x.rect(lx, ly, w, h);
            x.fill();
            x.strokeStyle = col;
            x.lineWidth = 1 * k;
            x.stroke();
            x.fillStyle = col;
            x.textAlign = 'left';
            x.fillText(txt, lx + 7 * k, ly + h / 2, tw);
            x.restore();
            return {
                x: lx / k,
                y: ly / k,
                w: w / k,
                h: h / k
            };
        }

        function wrapLines(x, txt, maxW, max) {
            var words = String(txt).split(' '),
                lines = [],
                line = '',
                i = 0;
            while (i < words.length) {
                var test = line ? line + ' ' + words[i] : words[i];
                if (x.measureText(test).width <= maxW) {
                    line = test;
                    i++;
                    continue;
                }
                if (!line) {
                    line = words[i];
                    i++;
                }
                lines.push(line);
                line = '';
                if (lines.length === max) break;
            }
            if (lines.length < max && line) {
                lines.push(line);
                i = words.length;
            }
            if (i < words.length && lines.length) {
                var last = lines[lines.length - 1] + ' ' + words.slice(i).join(' ');
                while (last.length > 1 && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
                lines[lines.length - 1] = last.replace(/[\s,.]+$/, '') + '…';
            }
            return lines;
        }

        function idMapKey(P, w, h) {
            return [E.sceneKey, JSON.stringify(E.cam), P.sliderU, P.plateU, P.locked, w, h].join('|');
        }

        function refreshIdMap(P) {
            var w = Math.max(1, Math.round(E.cssW / ID_DIV)),
                h = Math.max(1, Math.round(E.cssH / ID_DIV)),
                key = idMapKey(P, w, h);
            if (E.idKey === key && E.idBuf) return;
            var R = E.R,
                gl = R.gl;
            if (!E.idBuf || E.idBuf.length !== w * h * 4) E.idBuf = new Uint8Array(w * h * 4);
            R.pickPass(function(setId) {
                drawIds(setId);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, E.idBuf);
            }, w, h);
            E.idW = w;
            E.idH = h;
            E.idKey = key;
            E.pickSerial = -1;
        }

        function visibleNear(id, sx, sy) {
            var buf = E.idBuf,
                w = E.idW,
                h = E.idH;
            if (!buf) return null;
            var best = null,
                bd = Infinity,
                cx = sx / ID_DIV,
                cy = sy / ID_DIV;
            for (var y = 1; y < h - 1; y++) {
                var row = (h - 1 - y) * w;
                for (var xx = 1; xx < w - 1; xx++) {
                    var i = (row + xx) * 4;
                    if (buf[i + 2] < 128 || buf[i] + 256 * buf[i + 1] !== id) continue;
                    var d = (xx - cx) * (xx - cx) + (y - cy) * (y - cy);
                    if (d < bd) {
                        bd = d;
                        best = [xx, y];
                    }
                }
            }
            return best ? [best[0] * ID_DIV + ID_DIV / 2, best[1] * ID_DIV + ID_DIV / 2] : null;
        }

        function drawHud(x, sz, P, IR) {
            var items = hudPlan(H, P, E),
                k = sz.w / (E.cssW || sz.w),
                W = E.cssW,
                Ht = E.cssH;
            E.hudItems = items;
            var B = camBasis(E.cam, W, Ht);

            function pr(p) {
                var q = project(B, p);
                return q.depth > 0 ? [q.x, q.y] : null;
            }

            function line(a, b, col, lw, dash, glow) {
                var p = pr(a),
                    q = pr(b);
                if (!p || !q) return;
                x.save();
                x.strokeStyle = col;
                x.lineWidth = lw * k;
                x.lineCap = 'round';
                if (dash) x.setLineDash(dash.map(function(d) {
                    return d * k;
                }));
                if (glow) {
                    x.shadowColor = glow;
                    x.shadowBlur = 8 * k;
                }
                x.beginPath();
                x.moveTo(p[0] * k, p[1] * k);
                x.lineTo(q[0] * k, q[1] * k);
                x.stroke();
                x.restore();
            }

            function dot(p, r, col) {
                x.save();
                x.fillStyle = col;
                x.beginPath();
                x.arc(p[0] * k, p[1] * k, r * k, 0, TAU);
                x.fill();
                x.restore();
            }

            function arrowHead(p, q, col) { // a head at q pointing from p
                var dx = q[0] - p[0],
                    dy = q[1] - p[1],
                    l = Math.hypot(dx, dy) || 1,
                    ux = dx / l,
                    uy = dy / l,
                    s = 6;
                x.save();
                x.fillStyle = col;
                x.beginPath();
                x.moveTo(q[0] * k, q[1] * k);
                x.lineTo((q[0] - ux * s - uy * s * 0.5) * k, (q[1] - uy * s + ux * s * 0.5) * k);
                x.lineTo((q[0] - ux * s + uy * s * 0.5) * k, (q[1] - uy * s - ux * s * 0.5) * k);
                x.closePath();
                x.fill();
                x.restore();
            }
            var hasCap = items.some(function(it) {
                return it.kind === 'caption';
            });
            E.hudFloor = hasCap ? Ht - BAND_H - BAND_PAD : Ht;
            var placed = [],
                bar = stageRect(E.bar),
                tb = stageRect(typeof document !== 'undefined' && document.getElementById ? document.getElementById('teach-bar') : null);
            if (IR) placed.push({
                x: IR.x,
                y: IR.y,
                w: IR.w,
                h: IR.h + 22
            });

            function free(r) {
                return placed.every(function(o) {
                    return r.x + r.w < o.x || o.x + o.w < r.x || r.y + r.h < o.y || o.y + o.h < r.y;
                });
            }
            var anyLabel = items.some(function(it) {
                return it.kind === 'label';
            });
            var wantLabels = anyLabel && labelsReady();
            E.labelsDeferred = anyLabel && !wantLabels;
            if (wantLabels) refreshIdMap(P);
            else if (E.labelsDeferred) kick();
            var pulseT = nowMs() / 600 % 1;
            items.forEach(function(it) {
                if (it.kind === 'reading') placed.push(chip(x, k, 14, IR ? IR.y + IR.h + 20 : 24, it.text, '#e8f1ff', 'left'));
                else if (it.kind === 'warn' || it.kind === 'parallaxPlate') {
                    var floor = bar ? bar.y - 8 : Ht - 52;
                    placed.push(chip(x, k, W / 2, floor - 12, it.text, it.kind === 'warn' ? '#ffb74d' : '#e8f1ff', 'center', W - 40));
                } else if (it.kind === 'gold') line(it.anchor, it.anchor2, '#FFD700', 2.2, null, 'rgba(255,215,0,0.8)');
                else if (it.kind === 'contact') {
                    var col = it.on ? 'rgba(61,220,132,0.95)' : 'rgba(150,200,255,0.0)';
                    if (!it.on) return;
                    if (it.dots) {
                        var d1 = pr(it.anchor),
                            d2 = pr(it.anchor2);
                        if (d1) dot(d1, 3.2, col);
                        if (d2) dot(d2, 3.2, col);
                    } else line(it.anchor, it.anchor2, col, 2.6, null, 'rgba(61,220,132,0.9)');
                } else if (it.kind === 'datum') line(it.anchor, it.anchor2, H.wpInContact() ? 'rgba(61,220,132,0.85)' : 'rgba(150,200,255,0.6)', 2, [5, 4]);
                else if (it.kind === 'dim') {
                    var a = pr(it.anchor),
                        b = pr(it.anchor2);
                    if (!a || !b) return;
                    if (Math.min(a[0], b[0]) < 0 || Math.max(a[0], b[0]) > W || Math.min(a[1], b[1]) < 0 || Math.max(a[1], b[1]) > Ht) return;
                    var col2 = '#9fd3ff';
                    x.save();
                    x.strokeStyle = col2;
                    x.lineWidth = 1.3 * k;
                    x.beginPath();
                    x.moveTo(a[0] * k, a[1] * k);
                    x.lineTo(b[0] * k, b[1] * k);
                    x.stroke();
                    x.restore();
                    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 14) {
                        arrowHead(b, a, col2);
                        arrowHead(a, b, col2);
                    }
                    // the value goes on the side of the line AWAY from the instrument (stated per dimension), so it never
                    // sits on the jaws or the part it is measuring
                    var mx = (a[0] + b[0]) / 2,
                        my = Math.min(a[1], b[1]);
                    if (it.side === 'right') { // beside the sliding jaw's tip, where the space under the slider is empty
                        var rx = Math.max(a[0], b[0]) + 12,
                            ry = a[0] > b[0] ? a[1] : b[1];
                        placed.push(chip(x, k, rx, ry, it.text, col2, 'left', W - rx - 8));
                    } else placed.push(chip(x, k, mx, my - 16, it.text, col2, 'center', W - 30));
                } else if (it.kind === 'label' && wantLabels) {
                    var s = pr(it.anchor);
                    if (!s) return;
                    var v = visibleNear(it.id, s[0], s[1]);
                    if (!v) return;
                    x.save();
                    x.font = '600 ' + 12 * k + "px 'Segoe UI', system-ui, sans-serif";
                    var tw = x.measureText(it.text).width / k + 14;
                    x.restore();
                    var cands = [
                            [16, -26],
                            [16, 8],
                            [-16 - tw, -26],
                            [-16 - tw, 8],
                            [16, -48],
                            [-16 - tw, -48]
                        ],
                        got = null;
                    for (var c = 0; c < cands.length && !got; c++) {
                        var r = {
                            x: v[0] + cands[c][0],
                            y: v[1] + cands[c][1],
                            w: tw,
                            h: 20
                        };
                        if (r.x >= 4 && r.y >= 4 && r.x + r.w <= W - 4 && r.y + r.h <= (bar ? bar.y : Ht) - 4 && free(r)) got = r;
                    }
                    if (!got) return;
                    x.save();
                    x.strokeStyle = 'rgba(232,241,255,0.75)';
                    x.lineWidth = 1 * k;
                    x.beginPath();
                    x.moveTo(v[0] * k, v[1] * k);
                    x.lineTo((got.x < v[0] ? got.x + got.w : got.x) * k, (got.y + 10) * k);
                    x.stroke();
                    x.restore();
                    dot(v, 2.5, '#e8f1ff');
                    placed.push(chip(x, k, got.x, got.y + 10, it.text, '#e8f1ff', 'left'));
                } else if (it.kind === 'msrLine') {
                    line(it.anchor, it.anchor2, '#4fc3f7', 2.5);
                    var e2 = pr(it.anchor2);
                    if (e2 && !it.done) dot(e2, 3.5, '#4fc3f7');
                } else if (it.kind === 'indexLine') line(it.anchor, it.anchor2, 'rgba(255,85,85,0.95)', 1.5);
                else if (it.kind === 'msrLeader') {
                    var am = pr(it.anchor);
                    if (!am) return;
                    var colm = it.told ? '#4fc3f7' : '#8b9dc3';
                    // below and left of the graduation, in the clear band under the beam the 2D tool also uses —
                    // above it the chip would sit on the numerals it is asking the student to read
                    var r2 = chip(x, k, am[0] - 150, am[1] + 92, it.text, colm, 'left', W - 24);
                    placed.push(r2);
                    var tx0 = Math.min(r2.x + r2.w - 12, am[0] - 6),
                        ty0 = r2.y;
                    x.save();
                    x.strokeStyle = colm;
                    x.lineWidth = 1.6 * k;
                    x.beginPath();
                    x.moveTo(tx0 * k, ty0 * k);
                    x.lineTo(am[0] * k, (am[1] + 4) * k);
                    x.stroke();
                    x.restore();
                    arrowHead([tx0, ty0], [am[0], am[1] + 2], colm);
                } else if (it.kind === 'vline') {
                    var p1 = pr(it.anchor),
                        p2 = pr(it.anchor2);
                    if (!p1 || !p2) return;
                    if (it.state === 'match') {
                        line(it.anchor, it.anchor2, '#FFD700', 2.4, null, 'rgba(255,215,0,0.8)');
                    } else if (it.state === 'reject') {
                        var al = it.faint ? 0.42 : 0.95,
                            m = 3.6,
                            cx = p2[0],
                            cy = p2[1] + 8;
                        x.save();
                        x.strokeStyle = 'rgba(255,110,110,' + al + ')';
                        x.lineWidth = 1.8 * k;
                        x.beginPath();
                        x.moveTo((cx - m) * k, (cy - m) * k);
                        x.lineTo((cx + m) * k, (cy + m) * k);
                        x.moveTo((cx + m) * k, (cy - m) * k);
                        x.lineTo((cx - m) * k, (cy + m) * k);
                        x.stroke();
                        x.restore();
                    } else line(it.anchor, it.anchor2, 'rgba(129,199,132,0.95)', 1.8);
                } else if (it.kind === 'collinear') line(it.anchor, it.anchor2, '#FFD700', 2.4, null, 'rgba(255,215,0,0.85)');
                else if (it.kind === 'marker') {
                    var mp = pr(it.anchor);
                    if (!mp) return;
                    x.save();
                    x.fillStyle = '#FFD700';
                    x.beginPath();
                    x.moveTo(mp[0] * k, (mp[1] - 1) * k);
                    x.lineTo((mp[0] - 5) * k, (mp[1] - 10) * k);
                    x.lineTo((mp[0] + 5) * k, (mp[1] - 10) * k);
                    x.closePath();
                    x.fill();
                    x.restore();
                } else if (it.kind === 'chip' || it.kind === 'chip2') {
                    var cp = pr(it.anchor);
                    if (!cp) return;
                    placed.push(chip(x, k, cp[0], cp[1] + (it.kind === 'chip2' ? 14 : 4), it.text, it.col, 'center'));
                } else if (it.kind === 'pulse') {
                    var pp = pr(it.anchor);
                    if (!pp) return;
                    x.save();
                    x.strokeStyle = 'rgba(255,215,0,' + (0.9 - 0.8 * pulseT) + ')';
                    x.lineWidth = 2 * k;
                    x.beginPath();
                    x.arc(pp[0] * k, pp[1] * k, (6 + 10 * pulseT) * k, 0, TAU);
                    x.stroke();
                    x.restore();
                } else if (it.kind === 'plate') {
                    placed.push(chip(x, k, W / 2, E.hudFloor - 22, it.text, '#81c784', 'center', W - 30));
                } else if (it.kind === 'caption') {
                    var bx = BAND_PAD,
                        by = Ht - BAND_H - BAND_PAD,
                        bw = W - 2 * BAND_PAD;
                    if (tb && tb.y + tb.h > by && tb.y < by + BAND_H) bw = Math.max(120, tb.x - 10 - bx);
                    x.save();
                    x.fillStyle = 'rgba(8,12,18,0.92)';
                    x.beginPath();
                    if (x.roundRect) x.roundRect(bx * k, by * k, bw * k, BAND_H * k, 9 * k);
                    else x.rect(bx * k, by * k, bw * k, BAND_H * k);
                    x.fill();
                    x.strokeStyle = 'rgba(79,142,247,0.5)';
                    x.lineWidth = k;
                    x.stroke();
                    x.fillStyle = 'rgba(79,142,247,0.85)';
                    x.fillRect(bx * k, (by + BAND_H - 3) * k, bw * it.progress * k, 3 * k);
                    x.textBaseline = 'middle';
                    x.textAlign = 'left';
                    x.fillStyle = '#4f8ef7';
                    x.font = 'bold ' + 12.5 * k + 'px sans-serif';
                    x.fillText(it.title, (bx + 12) * k, (by + 14) * k, (bw - 70) * k);
                    x.fillStyle = '#9fb0cc';
                    x.font = 11.3 * k + 'px sans-serif';
                    wrapLines(x, it.text, (bw - 24) * k, 2).forEach(function(ln, i) {
                        x.fillText(ln, (bx + 12) * k, (by + 31 + i * 14) * k);
                    });
                    x.fillStyle = '#6b7a99';
                    x.font = 10.6 * k + 'px sans-serif';
                    x.textAlign = 'right';
                    x.fillText(it.step, (bx + bw - 12) * k, (by + 14) * k);
                    x.restore();
                }
            });
            if (IR) drawInsetFrame(x, k, IR, P);
            E.cubeL = cubeLayout();
            if (E.cubeL) VCUBE.draw(x, k, E.cam.yaw, E.cam.pitch, E.cubeL, E.cubeHover);
            else E.cubeHover = null;
        }
        // The inset's frame and its one-line status. Contact is not the answer; the value appears only on reveal.
        function drawInsetFrame(x, k, IR, P) {
            var on = H.wpInContact(),
                wp = H.st.wp;
            x.save();
            x.strokeStyle = on ? 'rgba(61,220,132,0.95)' : 'rgba(150,170,200,0.7)';
            x.lineWidth = 1.5 * k;
            x.beginPath();
            if (x.roundRect) x.roundRect(IR.x * k, IR.y * k, IR.w * k, IR.h * k, 8 * k);
            else x.rect(IR.x * k, IR.y * k, IR.w * k, IR.h * k);
            x.stroke();
            x.restore();
            var what = wp.kind === 'internal' ? 'Knife edges in the bore (cut)' : wp.kind === 'depth' ? 'Rod in the hole (cut)' : 'Jaws on the part';
            chip(x, k, IR.x + 6, IR.y + IR.h - 12, (on ? '\u2713 ' : '') + what + (on ? ' \u2014 touching' : ''), on ? '#3ddc84' : '#c9d4e6', 'left', IR.w - 10, 'rgba(8,12,18,0.82)');
            // the inset is a button: tapping it opens the same view full size
            chip(x, k, IR.x + IR.w - 6, IR.y + 13, '\u2922 Enlarge', '#c9d4e6', 'right', 90, 'rgba(8,12,18,0.82)');
        }
        /* ── the CAD view cube (desktop only): the kit paints and hit-tests it; here it is placed under the
           canvas toolbar, hidden while a walkthrough steers the camera, and a click eases the camera there
           through the same returnCam path a walkthrough's end uses, then leaves it free. ── */
        function cubeLayout() {
            if (!VCUBE || !E.cam || teachRunning() || !VCUBE.wanted(typeof window !== 'undefined' ? window : null)) return null;
            var card = E.stage && E.stage.closest ? E.stage.closest('.canvas-card') : null;
            var tb = stageRect(card && card.querySelector ? card.querySelector('.canvas-toolbar') : null),
                W = E.cssW,
                top = 8;
            if (tb && tb.x + tb.w > W - VCUBE.VC.BOX - 40) top = Math.max(top, tb.y + tb.h + 6);
            return VCUBE.layout(W, E.cssH, top);
        }

        function cubeGo(d) {
            var v = VCUBE.viewFor(d),
                c = E.cam;
            E.returnCam = {
                yaw: v.yaw,
                pitch: v.pitch,
                dist: c.dist,
                fov: c.fov,
                target: c.target.slice()
            };
            E.returnFree = true;
            E.free = false;
            kick();
        }

        function cubeHoverAt(p) {
            var h = E.cubeL && p ? VCUBE.hit(p[0], p[1], E.cam.yaw, E.cam.pitch, E.cubeL) : null;
            var key = h ? h.kind + (h.d ? h.d.join() : '') : '',
                was = E.cubeHover ? E.cubeHover.kind + (E.cubeHover.d ? E.cubeHover.d.join() : '') : '';
            if (key === was) return;
            E.cubeHover = h;
            if (E.gl && !E.orbit && !E.slide) E.gl.style.cursor = h ? 'pointer' : '';
            H.render();
        }

        function setView(name) {
            var spec = PRESETS[name];
            if (!spec) return;
            E.view = name;
            E.free = false;
            E.returnCam = null;
            E.parallax = name === 'parallax';
            if (E.teachSaved && !teachRunning()) {
                E.teachSaved = null;
                E.teachKey = null;
            } else if (E.teachSaved) E.teachSaved = {
                free: false,
                cam: null
            };
            syncBar();
            H.render();
            kick();
        }

        function ensureScene() {
            var key = geomKey(H, E.tier);
            if (key === E.sceneKey) return;
            Object.keys(E.meshes).forEach(function(n) {
                E.R.free(E.meshes[n]);
            });
            E.meshes = {};
            var S = buildScene(H, E.tier);
            Object.keys(S.geos).forEach(function(n) {
                E.meshes[n] = E.R.upload(S.geos[n]);
            });
            E.items = S.items;
            E.sceneKey = key;
        }

        function ensureTex(which, key, paint, W0, H0, repeat) {
            var gl = E.R.gl,
                t = E.tex[which];
            if (t && t.key === key) return t.tex;
            if (t) gl.deleteTexture(t.tex);
            var big = E.tier === 'full',
                c = paint(H, big ? W0 : W0 / 2, big ? H0 : H0 / 2),
                tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            var an = gl.getExtension('EXT_texture_filter_anisotropic');
            if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
            E.tex[which] = {
                key: key,
                tex: tex
            };
            return tex;
        }
        // Draw every item with camera V into the current viewport.
        function drawPass(R, gl, V, asp, M, F32, texs, LVP, T, cut, vpX, vpY, vpW, vpH) {
            var on = cut != null;
            var eye = K.orbitEye(V.target, V.yaw, V.pitch, V.dist);
            var VP = K.mul(K.persp(V.fov, asp, 2, 3000), K.lookAt(eye, V.target, [0, 1, 0]));
            gl.viewport(vpX, vpY, vpW, vpH);
            var p = R.stdProgram();
            gl.useProgram(p);
            var Ld = KEY_LIGHT;
            gl.uniform3fv(R.U(p, 'uEye'), eye);
            gl.uniform3fv(R.U(p, 'uLight'), Ld);
            gl.uniform3fv(R.U(p, 'uCutN'), [0, 0, 1]);
            gl.uniform1f(R.U(p, 'uCutD'), on ? cut : 0);
            gl.uniform3fv(R.U(p, 'uCutCol'), CUT_COL);
            gl.uniformMatrix4fv(R.U(p, 'uShadowVP'), false, LVP);
            gl.uniform1i(R.U(p, 'uShadowOn'), T.shadows ? 1 : 0);
            gl.uniform1i(R.U(p, 'uTex'), 0);
            E.items.forEach(function(it) {
                var m = E.meshes[it.name];
                if (!m) return;
                var mat = MAT[it.mat] || MAT.chrome,
                    f = F32[it.name];
                gl.uniformMatrix4fv(R.U(p, 'uM'), false, f);
                gl.uniformMatrix4fv(R.U(p, 'uNM'), false, f);
                gl.uniformMatrix4fv(R.U(p, 'uMVP'), false, K.mul(VP, f));
                gl.uniform3fv(R.U(p, 'uCol'), mat.c);
                gl.uniform1f(R.U(p, 'uRough'), mat.r);
                gl.uniform1f(R.U(p, 'uMetal'), mat.m);
                gl.uniform1i(R.U(p, 'uCutOn'), on && it.clip ? 1 : 0);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, it.tex ? texs[it.tex] : null);
                gl.uniform1i(R.U(p, 'uTexOn'), it.tex ? 1 : 0);
                R.bind(m, p);
                gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
            });
            return {
                VP: VP,
                eye: eye
            };
        }

        function draw() {
            if (!E.on || E.failed || !E.R || !E.R.ok || !E.stage) return;
            var t0 = performance.now();
            var R = E.R,
                gl = R.gl,
                T = K.TIERS[E.tier] || K.TIERS.full,
                st = H.st;
            var sz = R.resize(E.stage.clientWidth || 1, E.stage.clientHeight || 1, T.dprMax);
            ensureScene();
            var texs = {
                main: ensureTex('main', [st.unit, st.impPrec, st.beamUnit, E.tier].join('|'), paintMainTex, 4096, 512),
                vern: ensureTex('vern', [st.unit, st.prec, st.impPrec, E.tier].join('|'), paintVernTex, 4096, 512),
                brush: ensureTex('brush', E.tier, paintBrushTex, 1024, 256, true)
            };
            var P = vcPose(H),
                M = partMatrices(H, P),
                asp = sz.w / sz.h;
            E.asp = asp;
            E.cssW = E.stage.clientWidth || 1;
            E.cssH = E.stage.clientHeight || 1;
            syncTeach();
            var poseKey = [P.sliderU, P.plateU, P.locked].join('|');
            if (poseKey !== E.poseKey) {
                E.poseKey = poseKey;
                E.poseT = nowMs();
            }
            if (!E.cam) E.cam = copyCam(camTarget());
            var V = E.cam;
            E.camArrived = E.free || camNear(V, camTarget());
            // one shadow map for both views: the light frustum covers the whole instrument (it shadows itself)
            var Ld = KEY_LIGHT,
                rS = 165,
                ctr = [80, -10, 0];
            var LVP = K.mul(K.ortho(-rS, rS, -rS, rS, 20, 700), K.lookAt(K.add(ctr, K.scl(Ld, 330)), ctr, [0, 1, 0]));
            var F32 = {};
            E.items.forEach(function(it) {
                F32[it.name] = new Float32Array(M[it.name]);
            });
            if (T.shadows) R.shadowPass(function(dp) {
                E.items.forEach(function(it) {
                    var m = E.meshes[it.name];
                    if (!m) return;
                    gl.uniformMatrix4fv(R.U(dp, 'uM'), false, F32[it.name]);
                    R.bind(m, dp);
                    gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
                });
            }, LVP, 2048);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.disable(gl.SCISSOR_TEST);
            gl.viewport(0, 0, sz.w, sz.h);
            gl.clearColor(0.085, 0.092, 0.108, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.disable(gl.BLEND);
            var main = drawPass(R, gl, V, asp, M, F32, texs, LVP, T, V.cut, 0, 0, sz.w, sz.h);
            E.lastVP = main.VP;
            E.lastF32 = F32;
            E.lastEye = main.eye;
            E.drawSerial++;
            // the contact inset: the Measure camera, live, in its own scissored viewport
            var IR = null;
            if (insetWanted(H, E)) {
                IR = insetRect(E.cssW, E.cssH);
                var kk = sz.w / E.cssW,
                    ix = Math.round(IR.x * kk),
                    iw = Math.round(IR.w * kk),
                    ih = Math.round(IR.h * kk),
                    iy = Math.round(sz.h - (IR.y + IR.h) * kk);
                var mv = presetsFor(H, E.freezeP || P, IR.w / IR.h, {
                    only: 'measure'
                }).measure;
                gl.enable(gl.SCISSOR_TEST);
                gl.scissor(ix, iy, iw, ih);
                gl.clearColor(0.05, 0.06, 0.075, 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                drawPass(R, gl, mv, IR.w / IR.h, M, F32, texs, LVP, T, mv.cut, ix, iy, iw, ih);
                gl.disable(gl.SCISSOR_TEST);
                gl.viewport(0, 0, sz.w, sz.h);
            }
            E.insetRect = IR;
            if (camBusy()) kick();
            if (E.hud) {
                if (E.hud.width !== sz.w || E.hud.height !== sz.h) {
                    E.hud.width = sz.w;
                    E.hud.height = sz.h;
                } else E.hud.getContext('2d').clearRect(0, 0, sz.w, sz.h);
                drawHud(E.hud.getContext('2d'), sz, P, IR);
                if (hudAnimating()) kick();
            }
            var dtMs = performance.now() - t0;
            E.frameMs.push(dtMs);
            if (E.frameMs.length > 300) E.frameMs.shift();
            if (E.gov) {
                var nt = E.gov.sample(dtMs);
                if (nt !== E.tier) {
                    E.tier = nt;
                    E.sceneKey = null;
                    setTimeout(function() {
                        if (E.on && !E.failed) draw();
                    }, 0);
                }
            }
        }

        function drawIds(setId) {
            var R = E.R,
                gl = R.gl,
                p = R.stdProgram(),
                cut = E.cam && E.cam.cut != null ? E.cam.cut : null;
            gl.useProgram(p);
            gl.uniform3fv(R.U(p, 'uEye'), E.lastEye);
            gl.uniform1i(R.U(p, 'uShadowOn'), 0);
            gl.uniform1i(R.U(p, 'uTexOn'), 0);
            gl.uniform3fv(R.U(p, 'uCutN'), [0, 0, 1]);
            gl.uniform1f(R.U(p, 'uCutD'), cut == null ? 0 : cut);
            E.items.forEach(function(it) {
                var m = E.meshes[it.name],
                    f = E.lastF32[it.name];
                if (!m || !f) return;
                gl.uniformMatrix4fv(R.U(p, 'uM'), false, f);
                gl.uniformMatrix4fv(R.U(p, 'uNM'), false, f);
                gl.uniformMatrix4fv(R.U(p, 'uMVP'), false, K.mul(E.lastVP, f));
                gl.uniform1i(R.U(p, 'uCutOn'), cut != null && it.clip ? 1 : 0);
                setId(it.id);
                R.bind(m, p);
                gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
            });
        }

        function pick(x, y) {
            if (!E.R || !E.R.ok || !E.lastVP || !E.items.length) return 0;
            var w = Math.max(1, Math.round(E.cssW)),
                h = Math.max(1, Math.round(E.cssH));
            if (E.pickSerial !== E.drawSerial || E.pickW !== w || E.pickH !== h) {
                E.R.pickPass(drawIds, w, h);
                E.pickSerial = E.drawSerial;
                E.pickW = w;
                E.pickH = h;
            }
            return E.R.pickAt(x, y);
        }

        function inInset(p) {
            var r = E.insetRect;
            return !!r && p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
        }

        function local(e) {
            var r = E.gl.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        }

        function ptrList() {
            return Object.keys(E.ptrs).map(function(k) {
                return E.ptrs[k];
            });
        }

        function startPinch() {
            var a = ptrList();
            if (a.length < 2) return;
            // Two fingers are a camera gesture. If the first finger landed on the slider it is not a slide: drop
            // it without the roller's click, and put back whatever it moved in the moment before the second
            // finger arrived.
            var S0 = E.slide;
            if (S0) {
                E.slide = null;
                E.freezeP = null;
                if (S0.moved && !S0.dead && nowMs() - S0.t0 < PINCH_UNDO_MS && H.st.mm !== S0.mmStart) H.moveJawsTo(S0.mmStart, {
                    sound: false
                });
            }
            E.orbit = null;
            E.free = true;
            E.pinch = {
                d0: Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]) || 1,
                a0: Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]),
                m0: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2],
                cam: copyCam(E.cam)
            };
        }

        function panBy(c, dx, dy) {
            var B = camBasis(c, E.cssW, E.cssH),
                k = 2 * c.dist * B.t / E.cssH;
            c.target = K.add(c.target, K.add(K.scl(B.x, -dx * k), K.scl(B.y, dy * k)));
        }

        function clampCam(c) {
            c.pitch = K.clamp(c.pitch, -CUBE_PITCH, CUBE_PITCH);
            c.dist = K.clamp(c.dist, 15, 1400);
            return c;
        }

        function slideMove(x, y) {
            var S0 = E.slide;
            if (S0.dead) return;
            var along = (x - S0.x0) * S0.ax.dir[0] + (y - S0.y0) * S0.ax.dir[1];
            if (Math.abs(along) > 2) S0.moved = true;
            if (!S0.moved) return;
            var want = S0.mm0 + mmFromDrag(along, S0.ax, S0.fine, H.getLcMm());
            var r = H.moveJawsTo(want);
            if (r.refused) {
                S0.dead = true;
                return;
            }
            if (r.clamped) S0.mm0 -= (want - H.st.mm); // the part stops the jaws: no dead band on the way back
        }

        function endSlide() {
            var S0 = E.slide;
            if (!S0) return;
            E.slide = null;
            E.freezeP = null;
            // a press on the roller that never moved is a click: one least count, the half decides the sense
            if (S0.fine && !S0.moved && !S0.dead) H.moveJawsTo(H.st.mm + S0.dirClick * H.getLcMm());
            kick();
        }

        function wireInput() {
            var g = E.gl,
                ID = PART_ID;
            g.style.touchAction = 'none';
            g.addEventListener('contextmenu', function(e) {
                e.preventDefault();
            });
            g.addEventListener('pointerdown', function(e) {
                if (!E.on || E.failed) return;
                var p = local(e);
                if (inInset(p) && ptrList().length === 0) {
                    setView('measure');
                    return;
                }
                E.ptrs[e.pointerId] = p;
                try {
                    g.setPointerCapture(e.pointerId);
                } catch (err) { /* synthetic pointer: fine */ }
                if (ptrList().length >= 2) {
                    E.cubeDrag = null;
                    startPinch();
                    kick();
                    return;
                }
                var ch = E.cubeL && e.button === 0 ? VCUBE.hit(p[0], p[1], E.cam.yaw, E.cam.pitch, E.cubeL) : null;
                if (ch) {
                    E.cubeDrag = {
                        x0: p[0],
                        y0: p[1],
                        hit: ch,
                        moved: false
                    };
                    return;
                } // a click, or a drag that orbits
                var id = pick(p[0], p[1]);
                if (id === ID.lock) {
                    H.setLocked(!H.st.locked);
                    return;
                }
                var onSlide = PICK_SLIDE.indexOf(id) >= 0 || id === ID.roller;
                if (onSlide && e.button === 0 && !e.shiftKey) {
                    var P = vcPose(H),
                        ax = dragAxis(H, P, E.cam, E.cssW, E.cssH),
                        fine = id === ID.roller;
                    var rc = fine ? project(camBasis(E.cam, E.cssW, E.cssH), [P.sliderU + VC3D_DIM.rollerU, VC3D_DIM.rollerY, 0]) : null;
                    E.slide = {
                        x0: p[0],
                        y0: p[1],
                        mm0: H.st.mm,
                        mmStart: H.st.mm,
                        t0: nowMs(),
                        ax: ax,
                        fine: fine,
                        moved: false,
                        dead: false,
                        dirClick: rc ? ((p[0] - rc.x) * ax.dir[0] + (p[1] - rc.y) * ax.dir[1] >= 0 ? 1 : -1) : 1
                    };
                    E.freezeP = P;
                    // a refusal says so on the press, as 2D does (the lock flashes); nothing moves
                    if (H.st.locked || !H.canDragJaws()) {
                        var r0 = H.moveJawsTo(H.st.mm);
                        if (r0.refused) E.slide.dead = true;
                    }
                    g.style.cursor = 'grabbing';
                } else {
                    E.orbit = {
                        x: p[0],
                        y: p[1],
                        pan: e.button === 1 || e.button === 2 || e.shiftKey
                    };
                    g.style.cursor = 'move';
                }
                kick();
            });
            g.addEventListener('pointermove', function(e) {
                if (!E.ptrs[e.pointerId]) {
                    if (E.on && !E.failed && !ptrList().length) cubeHoverAt(local(e));
                    return;
                }
                var p = local(e);
                E.ptrs[e.pointerId] = p;
                // dragging the cube turns the camera exactly as dragging the background does
                if (E.cubeDrag && !E.cubeDrag.moved && Math.hypot(p[0] - E.cubeDrag.x0, p[1] - E.cubeDrag.y0) > 3) {
                    E.cubeDrag.moved = true;
                    E.orbit = {
                        x: E.cubeDrag.x0,
                        y: E.cubeDrag.y0,
                        pan: false
                    };
                    g.style.cursor = 'move';
                }
                if (E.pinch) {
                    var a = ptrList();
                    if (a.length < 2) return;
                    var P0 = E.pinch,
                        d = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]) || 1,
                        ang = Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]);
                    var c = copyCam(P0.cam);
                    c.dist = P0.cam.dist * P0.d0 / d;
                    c.yaw = P0.cam.yaw - (ang - P0.a0);
                    panBy(c, (a[0][0] + a[1][0]) / 2 - P0.m0[0], (a[0][1] + a[1][1]) / 2 - P0.m0[1]);
                    E.cam = clampCam(c);
                    H.render();
                } else if (E.slide) slideMove(p[0], p[1]);
                else if (E.orbit) {
                    var dx = p[0] - E.orbit.x,
                        dy = p[1] - E.orbit.y;
                    E.orbit.x = p[0];
                    E.orbit.y = p[1];
                    if (!dx && !dy) return;
                    E.free = true;
                    E.returnCam = null;
                    var cam = copyCam(E.cam);
                    if (E.orbit.pan) panBy(cam, dx, dy);
                    else {
                        cam.yaw -= dx * 0.008;
                        cam.pitch += dy * 0.008;
                    }
                    E.cam = clampCam(cam);
                    H.render();
                }
            });

            function end(e) {
                if (!E.ptrs[e.pointerId]) return;
                delete E.ptrs[e.pointerId];
                var left = ptrList(),
                    cd = E.cubeDrag;
                E.cubeDrag = null;
                if (cd && !cd.moved && e.type === 'pointerup' && !left.length) {
                    if (cd.hit.kind === 'home') setView('whole');
                    else cubeGo(cd.hit.d);
                }
                if (E.pinch && left.length === 1) {
                    E.pinch = null;
                    E.orbit = {
                        x: left[0][0],
                        y: left[0][1],
                        pan: false
                    };
                } else if (!left.length) {
                    E.pinch = null;
                    E.orbit = null;
                    endSlide();
                    g.style.cursor = '';
                    if (E.labels) H.render();
                }
                kick();
            }
            g.addEventListener('pointerup', end);
            g.addEventListener('pointerleave', function() {
                if (!ptrList().length) cubeHoverAt(null);
            });
            g.addEventListener('pointercancel', end);
            g.addEventListener('lostpointercapture', end);
            // Over the slider or roller one notch is one least count; anywhere else the page scrolls
            // (ctrl+wheel, a trackpad pinch, zooms the camera).
            g.addEventListener('wheel', function(e) {
                // A trackpad PINCH arrives as a wheel event with ctrlKey set (as does ctrl+wheel). It is always the
                // camera, wherever the pointer is — it must never move the jaws.
                if (e.ctrlKey) {
                    if (E.on) {
                        E.free = true;
                        var c = copyCam(E.cam);
                        c.dist *= Math.exp(e.deltaY * 0.004);
                        E.cam = clampCam(c);
                        H.render();
                        e.preventDefault();
                    }
                    return;
                }
                var p = local(e),
                    id = E.on && !inInset(p) ? pick(p[0], p[1]) : 0;
                var over = PICK_SLIDE.indexOf(id) >= 0 || id === ID.roller;
                if (!over) return;
                // Over the slider a mouse-wheel NOTCH is one least count. A trackpad's two-finger scroll sends a
                // stream of small deltas, so they are summed and a step is taken per notch's worth (WHEEL_NOTCH px).
                var steps = wheelSteps(E, e);
                if (!steps) {
                    if (!H.canDragJaws() && !H.st.locked) return;
                    e.preventDefault();
                    return;
                }
                // As in 2D: a mode that refuses the move leaves the page to scroll; a lock still eats the notch.
                var r = H.moveJawsTo(H.st.mm - steps * H.getLcMm());
                if (!r || r.refused !== 'mode') e.preventDefault();
            }, {
                passive: false
            });
        }
        /* ── toolbar: four views, labels, the inset, and the eye-angle slider for the parallax view ── */
        function buildBar() {
            var bar = document.createElement('div');
            bar.className = 'vc3d-bar';
            bar.setAttribute('role', 'group');
            bar.setAttribute('aria-label', '3D view');
            ['reading', 'whole', 'measure', 'parallax'].forEach(function(n) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'pill vc3d-btn';
                b.dataset.v3d = n;
                b.textContent = PRESETS[n].label;
                b.setAttribute('aria-pressed', 'false');
                b.addEventListener('click', function() {
                    setView(n);
                });
                bar.appendChild(b);
            });
            [
                ['labels', 'Labels'],
                ['inset', 'Close-up']
            ].forEach(function(d) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'pill vc3d-btn';
                b.dataset.v3d = d[0];
                b.textContent = d[1];
                b.setAttribute('aria-pressed', 'false');
                if (d[0] === 'inset') b.title = 'Show the jaws on the part in a corner view while you read the scales';
                b.addEventListener('click', function() {
                    E[d[0]] = !E[d[0]];
                    syncBar();
                    H.render();
                });
                bar.appendChild(b);
            });
            var rg = document.createElement('input');
            rg.type = 'range';
            rg.className = 'vc3d-range';
            rg.min = '-30';
            rg.max = '30';
            rg.step = '1';
            rg.value = String(PRESETS.parallax.eyeDeg);
            rg.setAttribute('aria-label', 'Eye angle');
            rg.hidden = true;
            rg.addEventListener('input', function() {
                E.eyeDeg = +rg.value || 0;
                rg.setAttribute('aria-valuetext', E.eyeDeg + ' degrees off square');
                if (E.view === 'parallax') {
                    E.free = false;
                    H.render();
                    kick();
                }
            });
            bar.appendChild(rg);
            E.bar = bar;
            E.range = rg;
            return bar;
        }

        function syncBar() {
            if (!E.bar) return;
            E.bar.querySelectorAll('button[data-v3d]').forEach(function(b) {
                var v = b.dataset.v3d;
                b.setAttribute('aria-pressed', String(v === 'labels' ? E.labels : v === 'inset' ? E.inset : v === E.view));
                if (v === 'inset') b.hidden = !H.st.wp;
            });
            E.range.hidden = E.view !== 'parallax';
        }

        function setMsg(html) {
            var m = E.stage.querySelector('.vc3d-msg');
            if (!m) {
                m = document.createElement('div');
                m.className = 'vc3d-msg';
                E.stage.appendChild(m);
            }
            m.innerHTML = html;
            var b = m.querySelector('.vc3d-back');
            if (b) b.addEventListener('click', function() {
                H.backTo2d();
            });
        }

        function lost() {
            E.failed = true;
            stopLoop();
            setMsg('Lost the 3D view — restoring… <button type="button" class="vc3d-back">Back to 2D</button>');
        }

        function restored() {
            if (!E.R || !E.R.ok) return;
            E.failed = false;
            E.meshes = {};
            E.tex = {};
            E.sceneKey = '';
            E.idBuf = null;
            E.idKey = null;
            E.pickSerial = -1;
            var m = E.stage && E.stage.querySelector('.vc3d-msg');
            if (m && m.parentNode) m.parentNode.removeChild(m);
            draw();
            kick();
        }

        function fail(reason) {
            E.failed = true;
            var why = /\.\s*$/.test(String(reason)) ? String(reason) : '3D needs WebGL, which this browser could not start (' + reason + ').';
            setMsg(why + ' <button type="button" class="vc3d-back">Back to 2D</button>');
        }
        return {
            mount: function(stage) {
                if (E.mounted) return !E.failed;
                E.stage = stage;
                E.mounted = true;
                E.gl = document.createElement('canvas');
                E.gl.className = 'vc3d-gl';
                E.gl.tabIndex = 0;
                E.gl.setAttribute('aria-label', '3D vernier caliper. Drag the slider to move the jaws, the thumb roller for fine feed; drag the background to look around.');
                E.hud = document.createElement('canvas');
                E.hud.className = 'vc3d-hud';
                stage.appendChild(E.gl);
                stage.appendChild(E.hud);
                stage.appendChild(buildBar());
                syncBar();
                if (!K) {
                    fail('kit missing');
                    return false;
                }
                E.R = K.createRenderer(E.gl, {
                    onLost: lost,
                    onRestored: restored
                });
                if (!E.R || !E.R.ok) {
                    fail(E.R ? E.R.reason : 'no context');
                    return false;
                }
                E.tier = 'full';
                try {
                    var caps = E.R.caps() || {};
                    caps.w = window.innerWidth || 1280;
                    caps.coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
                    E.tier = K.pickTier(caps) || 'full';
                } catch (e) {
                    E.tier = 'full';
                }
                E.frameMs = [];
                E.gov = K.makeGovernor(E.tier, E.tier === 'full' ? 16 : 33);
                window.addEventListener('resize', function() {
                    draw();
                });
                wireInput();
                return true;
            },
            setOn: function(on) {
                var was = E.on;
                E.on = !!on;
                if (!E.on) stopLoop();
                else if (!was) draw();
            },
            frame: function() {
                syncBar();
                draw();
            },
            // Switching to 3D, a new question and a part loaded or taken out all start on the WHOLE instrument
            // (owner's call): the student sees what is being measured before choosing a close view.
            resetCamera: function() {
                setView('whole');
            },
            setView: setView,
            failed: function() {
                return E.failed;
            },
            // harnesses only: jump the camera to where it is easing (a hidden pane delivers no frames)
            _settle: function() {
                E.poseT = -1e9;
                if (!E.free) E.cam = copyCam(camTarget());
                draw();
            },
            _E: E
        };
    }
    // [VC-3D-END]

    var api = {
        create: create,
        vcPose: vcPose,
        vcMainMarks: vcMainMarks,
        vcVernierMarks: vcVernierMarks,
        vcVsdMm: vcVsdMm,
        vcCoincidence: vcCoincidence,
        VC3D_DIM: VC3D_DIM,
        buildScene: buildScene,
        partMatrices: partMatrices,
        PART_ID: PART_ID,
        PICK_SLIDE: PICK_SLIDE,
        readingView: readingView,
        measureView: measureView,
        presetsFor: presetsFor,
        PRESETS: PRESETS,
        parallaxShift: parallaxShift,
        parallaxReading: parallaxReading,
        parallaxPlan: parallaxPlan,
        camStep: camStep,
        camBasis: camBasis,
        project: project,
        dragAxis: dragAxis,
        mmFromDrag: mmFromDrag,
        FINE_PX: FINE_PX,
        wheelSteps: wheelSteps,
        hudPlan: hudPlan,
        teachPlan3d: teachPlan3d,
        contactPlan: contactPlan,
        coincidencePlan: coincidencePlan,
        labelAnchors: labelAnchors,
        insetWanted: insetWanted,
        insetRect: insetRect,
        insetPadFor: insetPadFor,
        depthBore: depthBore,
        fixedJawPoly: fixedJawPoly,
        slideJawPoly: slideJawPoly,
        bladePoly: bladePoly,
        bladeSpan: bladeSpan,
        bladeWidth: bladeWidth,
        _closed: _closed,
        _faces: _faces
    };
    if (typeof window !== 'undefined') window.VC3D = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();