const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  }
});

const now = () => new Date().toISOString();
const uid = "default";

function id() {
  return crypto.randomUUID();
}

async function getActiveSession(db) {
  return db.prepare(\`
    SELECT *
    FROM workout_sessions
    WHERE user_id = ? AND status = 'active'
    ORDER BY session_date DESC, created_at DESC
    LIMIT 1
  \`).bind(uid).first();
}

async function sessionPayload(db, session) {
  if (!session) return { active: false, session: null, exercises: [], sets: [], cardio: [] };

  const exercises = await db.prepare(\`
    SELECT *
    FROM session_exercises
    WHERE session_id = ?
    ORDER BY sort_order ASC, created_at ASC
  \`).bind(session.id).all();

  const sets = await db.prepare(\`
    SELECT ps.*, se.exercise_name
    FROM performance_sets ps
    JOIN session_exercises se ON se.id = ps.session_exercise_id
    WHERE ps.session_id = ?
    ORDER BY ps.recorded_at ASC
  \`).bind(session.id).all();

  const cardio = await db.prepare(\`
    SELECT *
    FROM cardio_sessions
    WHERE session_id = ?
    ORDER BY recorded_at ASC
  \`).bind(session.id).all();

  return { active: true, session, exercises: exercises.results || [], sets: sets.results || [], cardio: cardio.results || [] };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });

    if (!env.DB) return json({ ok:false, error:"D1 binding DB manquante" }, 500);

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok:true, service:"muscu-coach-sync-d1" });
      }

      if (request.method === "GET" && url.pathname === "/api/session") {
        return json(await sessionPayload(env.DB, await getActiveSession(env.DB)));
      }

      if (request.method === "GET" && url.pathname === "/api/session/latest") {
        return json(await sessionPayload(env.DB, await getLatestSession(env.DB)));
      }

      if (request.method === "GET" && url.pathname === "/api/history") {
        const sets = await env.DB.prepare(\`
          SELECT ps.*, ws.session_date, se.exercise_name
          FROM performance_sets ps
          JOIN workout_sessions ws ON ws.id = ps.session_id
          JOIN session_exercises se ON se.id = ps.session_exercise_id
          WHERE ws.user_id = ?
          ORDER BY ps.recorded_at DESC
          LIMIT 500
        \`).bind(uid).all();

        const cardio = await env.DB.prepare(\`
          SELECT cs.*, ws.session_date
          FROM cardio_sessions cs
          JOIN workout_sessions ws ON ws.id = cs.session_id
          WHERE ws.user_id = ?
          ORDER BY cs.recorded_at DESC
          LIMIT 200
        \`).bind(uid).all();

        return json({ ok:true, sets:sets.results || [], cardio:cardio.results || [] });
      }

      if (request.method === "POST" && url.pathname === "/api/session") {
        const body = await request.json();
        if (!body?.date) return json({ ok:false, error:"date manquante" }, 400);

        const session = {
          id: body.id || id(),
          user_id: uid,
          session_date: body.date,
          objective: body.objective || "",
          notes: body.notes || "",
          status: "active",
          created_at: now(),
          updated_at: now()
        };

        await env.DB.prepare(\`
          INSERT INTO workout_sessions(id,user_id,session_date,objective,notes,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            session_date=excluded.session_date,
            objective=excluded.objective,
            notes=excluded.notes,
            status=excluded.status,
            updated_at=excluded.updated_at
        \`).bind(
          session.id, session.user_id, session.session_date, session.objective,
          session.notes, session.status, session.created_at, session.updated_at
        ).run();

        await env.DB.prepare(\`DELETE FROM session_exercises WHERE session_id = ?\`).bind(session.id).run();

        for (const [index, e] of (body.exercises || []).entries()) {
          await env.DB.prepare(\`
            INSERT INTO session_exercises(
              id,session_id,exercise_name,subtitle,exercise_type,gif,
              sets_planned,reps_min,reps_max,rest_seconds,duration_minutes,
              intensity,is_extra,sort_order
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          \`).bind(
            e.id || id(), session.id, e.name || "", e.subtitle || "",
            e.exercise_type || "strength", e.gif || "",
            Number(e.sets || 1), e.reps_min ?? null, e.reps_max ?? null,
            e.rest_seconds ?? null, e.duration_minutes ?? null,
            e.intensity ?? null, e._extra ? 1 : 0, index
          ).run();
        }

        const saved = await env.DB.prepare(\`SELECT * FROM workout_sessions WHERE id = ?\`).bind(session.id).first();
        return json(await sessionPayload(env.DB, saved));
      }

      if (request.method === "POST" && url.pathname === "/api/session/exercise") {
        const b = await request.json();

        if (!b?.session_id || !b?.name) {
          return json({ ok:false, error:"session_id et name sont requis" }, 400);
        }

        const session = await env.DB.prepare(`
          SELECT id
          FROM workout_sessions
          WHERE id = ? AND user_id = ? AND status = 'active'
        `).bind(b.session_id, uid).first();

        if (!session) {
          return json({ ok:false, error:"Session active introuvable" }, 404);
        }

        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS c
          FROM session_exercises
          WHERE session_id = ?
        `).bind(b.session_id).first();

        const exerciseId = b.id || id();

        await env.DB.prepare(`
          INSERT INTO session_exercises(
            id,session_id,exercise_name,subtitle,exercise_type,gif,
            sets_planned,reps_min,reps_max,rest_seconds,duration_minutes,
            intensity,is_extra,sort_order
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          exerciseId,
          b.session_id,
          b.name,
          b.subtitle || "",
          b.exercise_type || "strength",
          b.gif || "",
          Number(b.sets || 1),
          b.reps_min ?? null,
          b.reps_max ?? null,
          b.rest_seconds ?? null,
          b.duration_minutes ?? null,
          b.intensity ?? null,
          1,
          Number(count?.c || 0)
        ).run();

        return json({ ok:true, exercise_id:exerciseId });
      }

      if (request.method === "POST" && url.pathname === "/api/set") {
        const b = await request.json();
        if (!b?.session_id || !b?.session_exercise_id || !b?.set_number) {
          return json({ ok:false, error:"session_id, session_exercise_id et set_number sont requis" }, 400);
        }

        await env.DB.prepare(\`
          INSERT INTO performance_sets(
            id,session_id,session_exercise_id,set_number,load_value,load_text,
            load_mode,left_load,right_load,reps,difficulty,pain,recorded_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(session_exercise_id,set_number) DO UPDATE SET
            load_value=excluded.load_value,
            load_text=excluded.load_text,
            load_mode=excluded.load_mode,
            left_load=excluded.left_load,
            right_load=excluded.right_load,
            reps=excluded.reps,
            difficulty=excluded.difficulty,
            pain=excluded.pain,
            recorded_at=excluded.recorded_at
        \`).bind(
          id(), b.session_id, b.session_exercise_id, Number(b.set_number),
          b.load_value ?? null, b.load_text || "", b.load_mode || "central",
          b.left_load ?? null, b.right_load ?? null, b.reps ?? null,
          b.difficulty || null, b.pain ?? null, now()
        ).run();

        return json({ ok:true });
      }

      if (request.method === "POST" && url.pathname === "/api/cardio") {
        const b = await request.json();
        if (!b?.session_id || !b?.cardio_name || !b?.duration_minutes) {
          return json({ ok:false, error:"session_id, cardio_name et duration_minutes sont requis" }, 400);
        }

        await env.DB.prepare(\`
          INSERT INTO cardio_sessions(
            id,session_id,session_exercise_id,cardio_name,duration_minutes,intensity,pain,recorded_at
          ) VALUES(?,?,?,?,?,?,?,?)
        \`).bind(
          id(), b.session_id, b.session_exercise_id || null, b.cardio_name,
          Number(b.duration_minutes), b.intensity || "modérée", b.pain ?? 0, now()
        ).run();

        return json({ ok:true });
      }

      if (request.method === "POST" && url.pathname === "/api/session/stop") {
        const result = await env.DB.prepare(\`
          UPDATE workout_sessions
          SET status='stopped', updated_at=?
          WHERE user_id=? AND status='active'
        \`).bind(now(), uid).run();

        return json({
          ok: true,
          stopped: Number(result?.meta?.changes || 0)
        });
      }

      if (request.method === "DELETE" && url.pathname === "/api/test-data") {
        await env.DB.batch([
          env.DB.prepare(\`DELETE FROM cardio_sessions WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id=?)\`).bind(uid),
          env.DB.prepare(\`DELETE FROM performance_sets WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id=?)\`).bind(uid),
          env.DB.prepare(\`DELETE FROM session_exercises WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id=?)\`).bind(uid),
          env.DB.prepare(\`DELETE FROM workout_sessions WHERE user_id=?\`).bind(uid)
        ]);
        return json({ ok:true, message:"Données d'entraînement supprimées" });
      }

      return json({ ok:false, error:"Route inconnue" }, 404);
    } catch (error) {
      return json({ ok:false, error:error.message || String(error) }, 500);
    }
  }
};
