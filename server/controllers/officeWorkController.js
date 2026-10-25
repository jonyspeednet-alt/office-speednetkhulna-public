const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');
let schemaReadyPromise = null;
let hasExtendedSchema = null;
let kpiSchemaReadyPromise = null;
let hasKpiTargetSchema = null;

const ensureOfficeWorkPerformanceSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      if (hasExtendedSchema !== null) return hasExtendedSchema;

      const existing = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'office_work_entries'
          AND column_name IN ('assignment_type', 'department_tags')
      `);
      if (existing.rows.length === 2) {
        hasExtendedSchema = true;
        return true;
      }

      try {
        await pool.query(`
          ALTER TABLE office_work_entries
          ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) NOT NULL DEFAULT 'single',
          ADD COLUMN IF NOT EXISTS department_tags TEXT[] NOT NULL DEFAULT '{}'::text[]
        `);
        await pool.query(`
          ALTER TABLE office_work_entries
          DROP CONSTRAINT IF EXISTS office_work_entries_assignment_type_check
        `);
        await pool.query(`
          ALTER TABLE office_work_entries
          ADD CONSTRAINT office_work_entries_assignment_type_check
          CHECK (assignment_type IN ('single', 'hybrid'))
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_office_work_assignment_type
          ON office_work_entries(assignment_type)
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_office_work_department_tags
          ON office_work_entries USING GIN(department_tags)
        `);
        hasExtendedSchema = true;
      } catch (error) {
        hasExtendedSchema = false;
        console.warn('Office work extended schema unavailable, using legacy mode:', error.message);
      }
      return hasExtendedSchema;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const normalizeDateParam = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '__invalid__';
};

const normalizeDepartmentTags = (input) => {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const cleaned = raw
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, 10);
};

const canViewOfficeWorkPerformance = (user) => {
  const role = String(user?.role_name || user?.role || '').trim().toLowerCase();
  // Name-based bypass only applies to legacy users without a role_id — a
  // role_id-linked role must have the actual permission ticked, even if
  // it's literally named "Admin"/"HR".
  if (!user?.role_id && (role === 'admin' || role === 'hr' || role === 'super admin' || role === 'superadmin')) return true;
  if (resolvePermission(user, 'users.manage')) return true;
  return resolvePermission(user, 'office_work.manage');
};

const daysBetweenInclusive = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = Math.floor((end - start) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : null;
};

const normalizeMonthParam = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : '__invalid__';
};

const getCurrentMonthKey = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const ensureOfficeWorkKpiSchema = async () => {
  if (!kpiSchemaReadyPromise) {
    kpiSchemaReadyPromise = (async () => {
      if (hasKpiTargetSchema !== null) return hasKpiTargetSchema;
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS office_work_kpi_targets (
            id BIGSERIAL PRIMARY KEY,
            month_key VARCHAR(7) NOT NULL,
            department TEXT NOT NULL,
            task_target INTEGER NOT NULL DEFAULT 0,
            completion_target NUMERIC(5,2) NOT NULL DEFAULT 80,
            minutes_target INTEGER NOT NULL DEFAULT 0,
            updated_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (month_key, department)
          )
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_office_kpi_month_dept
          ON office_work_kpi_targets(month_key, department)
        `);
        hasKpiTargetSchema = true;
      } catch (error) {
        hasKpiTargetSchema = false;
        console.warn('Office KPI target schema unavailable:', error.message);
      }
      return hasKpiTargetSchema;
    })().catch((error) => {
      kpiSchemaReadyPromise = null;
      throw error;
    });
  }
  return kpiSchemaReadyPromise;
};

/**
 * Get Office Work Entries for current user
 */
const getWorkEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT
        e.*,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', s.id,
              'work_date', s.work_date,
              'start_time', s.start_time,
              'end_time', s.end_time,
              'notes', s.notes,
              'duration_minutes', s.duration_minutes,
              'created_at', s.created_at
            )
            ORDER BY s.work_date DESC, s.start_time DESC
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS sessions,
        COALESCE(SUM(s.duration_minutes), 0)::int AS total_minutes
      FROM office_work_entries e
      LEFT JOIN office_work_sessions s ON s.entry_id = e.id
      WHERE e.user_id = $1
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching work entries:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Add new work entry
 */
const addWorkEntry = async (req, res) => {
  try {
    const extendedSchema = await ensureOfficeWorkPerformanceSchema();
    const userId = req.user.id;
    const { task, category, priority, work_date, start_time, end_time, assignment_type, department_tags } = req.body;

    if (!task || !task.trim()) {
      return res.status(400).json({ message: 'Task is required' });
    }

    const normalizedDate = String(work_date || '').trim();
    const normalizedStart = String(start_time || '').trim();
    const normalizedEnd = String(end_time || '').trim();

    if (!normalizedDate || !normalizedStart || !normalizedEnd) {
      return res.status(400).json({ message: 'work_date, start_time and end_time are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ message: 'Invalid work_date format (expected YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedStart) || !/^\d{2}:\d{2}$/.test(normalizedEnd)) {
      return res.status(400).json({ message: 'Invalid time format (expected HH:mm)' });
    }
    if (normalizedEnd <= normalizedStart) {
      return res.status(400).json({ message: 'end_time must be greater than start_time' });
    }

    const normalizedTags = normalizeDepartmentTags(department_tags);
    const normalizedAssignmentType = (String(assignment_type || '').trim().toLowerCase() === 'hybrid' || normalizedTags.length > 1)
      ? 'hybrid'
      : 'single';

    const result = extendedSchema
      ? await pool.query(
        `
          INSERT INTO office_work_entries (user_id, task, category, priority, work_date, start_time, end_time, assignment_type, department_tags)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
          RETURNING *
        `,
        [
          userId,
          task.trim(),
          category || 'general',
          priority || 'normal',
          normalizedDate,
          normalizedStart,
          normalizedEnd,
          normalizedAssignmentType,
          normalizedTags
        ]
      )
      : await pool.query(
        `
          INSERT INTO office_work_entries (user_id, task, category, priority, work_date, start_time, end_time)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [
          userId,
          task.trim(),
          category || 'general',
          priority || 'normal',
          normalizedDate,
          normalizedStart,
          normalizedEnd
        ]
      );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding work entry:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Toggle work entry completion
 */
const toggleWorkEntry = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // First check if entry belongs to user
    const checkQuery = `SELECT * FROM office_work_entries WHERE id = $1 AND user_id = $2`;
    const checkResult = await pool.query(checkQuery, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const updateQuery = `
      UPDATE office_work_entries 
      SET completed = NOT completed,
          completed_at = CASE WHEN completed = FALSE THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [id, userId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling work entry:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Update work entry
 */
const updateWorkEntry = async (req, res) => {
  try {
    const extendedSchema = await ensureOfficeWorkPerformanceSchema();
    const userId = req.user.id;
    const { id } = req.params;
    const { task, category, priority, work_date, start_time, end_time, assignment_type, department_tags } = req.body;

    if (!task || !task.trim()) {
      return res.status(400).json({ message: 'Task is required' });
    }

    const normalizedDate = String(work_date || '').trim();
    const normalizedStart = String(start_time || '').trim();
    const normalizedEnd = String(end_time || '').trim();

    if (!normalizedDate || !normalizedStart || !normalizedEnd) {
      return res.status(400).json({ message: 'work_date, start_time and end_time are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ message: 'Invalid work_date format (expected YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedStart) || !/^\d{2}:\d{2}$/.test(normalizedEnd)) {
      return res.status(400).json({ message: 'Invalid time format (expected HH:mm)' });
    }
    if (normalizedEnd <= normalizedStart) {
      return res.status(400).json({ message: 'end_time must be greater than start_time' });
    }

    const normalizedTags = normalizeDepartmentTags(department_tags);
    const normalizedAssignmentType = (String(assignment_type || '').trim().toLowerCase() === 'hybrid' || normalizedTags.length > 1)
      ? 'hybrid'
      : 'single';

    const result = extendedSchema
      ? await pool.query(
        `
          UPDATE office_work_entries
          SET task = $1,
              category = $2,
              priority = $3,
              work_date = $4,
              start_time = $5,
              end_time = $6,
              assignment_type = $7,
              department_tags = $8::text[],
              updated_at = NOW()
          WHERE id = $9 AND user_id = $10
          RETURNING *
        `,
        [
          task.trim(),
          category || 'general',
          priority || 'normal',
          normalizedDate,
          normalizedStart,
          normalizedEnd,
          normalizedAssignmentType,
          normalizedTags,
          id,
          userId
        ]
      )
      : await pool.query(
        `
          UPDATE office_work_entries
          SET task = $1,
              category = $2,
              priority = $3,
              work_date = $4,
              start_time = $5,
              end_time = $6,
              updated_at = NOW()
          WHERE id = $7 AND user_id = $8
          RETURNING *
        `,
        [
          task.trim(),
          category || 'general',
          priority || 'normal',
          normalizedDate,
          normalizedStart,
          normalizedEnd,
          id,
          userId
        ]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating work entry:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Delete work entry
 */
const deleteWorkEntry = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const query = `
      DELETE FROM office_work_entries 
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting work entry:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Add work session under a task
 */
const addWorkSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { work_date, start_time, end_time, notes } = req.body;

    const normalizedDate = String(work_date || '').trim();
    const normalizedStart = String(start_time || '').trim();
    const normalizedEnd = String(end_time || '').trim();
    const normalizedNotes = String(notes || '').trim();

    if (!normalizedDate || !normalizedStart || !normalizedEnd) {
      return res.status(400).json({ message: 'work_date, start_time and end_time are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ message: 'Invalid work_date format (expected YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedStart) || !/^\d{2}:\d{2}$/.test(normalizedEnd)) {
      return res.status(400).json({ message: 'Invalid time format (expected HH:mm)' });
    }
    if (normalizedEnd <= normalizedStart) {
      return res.status(400).json({ message: 'end_time must be greater than start_time' });
    }

    const owner = await pool.query(
      `SELECT id FROM office_work_entries WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (owner.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const insert = await pool.query(
      `
      INSERT INTO office_work_sessions (entry_id, user_id, work_date, start_time, end_time, notes, duration_minutes)
      VALUES (
        $1, $2, $3, $4, $5, $6,
        GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ($5::time - $4::time)) / 60)::int)
      )
      RETURNING *
      `,
      [id, userId, normalizedDate, normalizedStart, normalizedEnd, normalizedNotes || null]
    );

    await pool.query(
      `
      UPDATE office_work_entries
      SET updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      `,
      [id, userId]
    );

    res.status(201).json(insert.rows[0]);
  } catch (error) {
    console.error('Error adding work session:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Admin/HR performance summary by employee and department
 */
const getWorkPerformanceSummary = async (req, res) => {
  try {
    const extendedSchema = await ensureOfficeWorkPerformanceSchema();
    if (!canViewOfficeWorkPerformance(req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const startDate = normalizeDateParam(req.query.start_date);
    const endDate = normalizeDateParam(req.query.end_date);
    const department = String(req.query.department || '').trim();

    if (startDate === '__invalid__' || endDate === '__invalid__') {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ message: 'start_date must be <= end_date' });
    }

    const filters = [startDate, endDate, department || null];

    const employeeQuery = extendedSchema ? `
      WITH entry_base AS (
        SELECT
          e.id,
          e.user_id,
          e.work_date,
          u.full_name,
          u.employee_id,
          COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS home_department,
          e.completed,
          e.priority,
          CASE
            WHEN COALESCE(array_length(e.department_tags, 1), 0) > 1 OR LOWER(COALESCE(e.assignment_type, 'single')) = 'hybrid' THEN 1
            ELSE 0
          END AS is_hybrid,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes,
          COALESCE(e.department_tags, ARRAY[]::text[]) AS department_tags
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE ($1::date IS NULL OR e.work_date >= $1::date)
          AND ($2::date IS NULL OR e.work_date <= $2::date)
          AND (
            $3::text IS NULL
            OR LOWER(COALESCE(u.department, '')) = LOWER($3::text)
            OR EXISTS (
              SELECT 1
              FROM UNNEST(COALESCE(e.department_tags, ARRAY[]::text[])) AS tag
              WHERE LOWER(tag) = LOWER($3::text)
            )
          )
        GROUP BY
          e.id, e.user_id, u.full_name, u.employee_id, u.department,
          e.completed, e.priority, e.assignment_type, e.start_time, e.end_time, e.department_tags
      ),
      employee_stats AS (
        SELECT
          user_id,
          full_name,
          employee_id,
          home_department,
          COUNT(DISTINCT work_date)::int AS active_days,
          COUNT(*)::int AS total_tasks,
          SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
          SUM(CASE WHEN completed THEN 0 ELSE 1 END)::int AS pending_tasks,
          SUM(total_minutes)::int AS total_minutes,
          SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END)::int AS high_priority_tasks,
          SUM(is_hybrid)::int AS hybrid_tasks
        FROM entry_base
        GROUP BY user_id, full_name, employee_id, home_department
      )
      SELECT
        user_id,
        full_name,
        employee_id,
        home_department,
        active_days,
        total_tasks,
        completed_tasks,
        pending_tasks,
        total_minutes,
        high_priority_tasks,
        hybrid_tasks,
        ROUND((completed_tasks::numeric / NULLIF(total_tasks, 0)) * 100, 1) AS completion_rate,
        ROUND((total_minutes::numeric / NULLIF(total_tasks, 0)), 1) AS avg_minutes_per_task
      FROM employee_stats
      ORDER BY completion_rate DESC NULLS LAST, total_minutes DESC, total_tasks DESC, full_name ASC
    ` : `
      WITH entry_base AS (
        SELECT
          e.id,
          e.user_id,
          e.work_date,
          u.full_name,
          u.employee_id,
          COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS home_department,
          e.completed,
          e.priority,
          0 AS is_hybrid,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE ($1::date IS NULL OR e.work_date >= $1::date)
          AND ($2::date IS NULL OR e.work_date <= $2::date)
          AND (
            $3::text IS NULL
            OR LOWER(COALESCE(u.department, '')) = LOWER($3::text)
          )
        GROUP BY
          e.id, e.user_id, u.full_name, u.employee_id, u.department,
          e.completed, e.priority, e.start_time, e.end_time
      ),
      employee_stats AS (
        SELECT
          user_id,
          full_name,
          employee_id,
          home_department,
          COUNT(DISTINCT work_date)::int AS active_days,
          COUNT(*)::int AS total_tasks,
          SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
          SUM(CASE WHEN completed THEN 0 ELSE 1 END)::int AS pending_tasks,
          SUM(total_minutes)::int AS total_minutes,
          SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END)::int AS high_priority_tasks,
          SUM(is_hybrid)::int AS hybrid_tasks
        FROM entry_base
        GROUP BY user_id, full_name, employee_id, home_department
      )
      SELECT
        user_id,
        full_name,
        employee_id,
        home_department,
        active_days,
        total_tasks,
        completed_tasks,
        pending_tasks,
        total_minutes,
        high_priority_tasks,
        hybrid_tasks,
        ROUND((completed_tasks::numeric / NULLIF(total_tasks, 0)) * 100, 1) AS completion_rate,
        ROUND((total_minutes::numeric / NULLIF(total_tasks, 0)), 1) AS avg_minutes_per_task
      FROM employee_stats
      ORDER BY completion_rate DESC NULLS LAST, total_minutes DESC, total_tasks DESC, full_name ASC
    `;

    const departmentQuery = extendedSchema ? `
      WITH entry_base AS (
        SELECT
          e.id,
          e.user_id,
          COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS home_department,
          e.completed,
          CASE
            WHEN COALESCE(array_length(e.department_tags, 1), 0) > 1 OR LOWER(COALESCE(e.assignment_type, 'single')) = 'hybrid' THEN 1
            ELSE 0
          END AS is_hybrid,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes,
          COALESCE(e.department_tags, ARRAY[]::text[]) AS department_tags
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE ($1::date IS NULL OR e.work_date >= $1::date)
          AND ($2::date IS NULL OR e.work_date <= $2::date)
          AND (
            $3::text IS NULL
            OR LOWER(COALESCE(u.department, '')) = LOWER($3::text)
            OR EXISTS (
              SELECT 1
              FROM UNNEST(COALESCE(e.department_tags, ARRAY[]::text[])) AS tag
              WHERE LOWER(tag) = LOWER($3::text)
            )
          )
        GROUP BY
          e.id, e.user_id, u.department,
          e.completed, e.assignment_type, e.start_time, e.end_time, e.department_tags
      ),
      entry_expanded AS (
        SELECT
          b.id,
          b.user_id,
          b.completed,
          b.is_hybrid,
          b.total_minutes,
          COALESCE(NULLIF(TRIM(x.tag), ''), b.home_department) AS department
        FROM entry_base b
        LEFT JOIN LATERAL (
          SELECT UNNEST(
            CASE
              WHEN COALESCE(array_length(b.department_tags, 1), 0) > 0 THEN b.department_tags
              ELSE ARRAY[b.home_department]
            END
          ) AS tag
        ) x ON TRUE
      )
      SELECT
        department,
        COUNT(DISTINCT id)::int AS total_tasks,
        SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
        SUM(CASE WHEN completed THEN 0 ELSE 1 END)::int AS pending_tasks,
        SUM(total_minutes)::int AS total_minutes,
        SUM(is_hybrid)::int AS hybrid_tasks,
        COUNT(DISTINCT user_id)::int AS employee_count,
        ROUND((SUM(CASE WHEN completed THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(DISTINCT id), 0)) * 100, 1) AS completion_rate
      FROM entry_expanded
      GROUP BY department
      ORDER BY total_tasks DESC, total_minutes DESC, department ASC
    ` : `
      WITH entry_base AS (
        SELECT
          e.id,
          e.user_id,
          COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS department,
          e.completed,
          0 AS is_hybrid,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE ($1::date IS NULL OR e.work_date >= $1::date)
          AND ($2::date IS NULL OR e.work_date <= $2::date)
          AND (
            $3::text IS NULL
            OR LOWER(COALESCE(u.department, '')) = LOWER($3::text)
          )
        GROUP BY e.id, e.user_id, u.department, e.completed, e.start_time, e.end_time
      )
      SELECT
        department,
        COUNT(DISTINCT id)::int AS total_tasks,
        SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
        SUM(CASE WHEN completed THEN 0 ELSE 1 END)::int AS pending_tasks,
        SUM(total_minutes)::int AS total_minutes,
        SUM(is_hybrid)::int AS hybrid_tasks,
        COUNT(DISTINCT user_id)::int AS employee_count,
        ROUND((SUM(CASE WHEN completed THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(DISTINCT id), 0)) * 100, 1) AS completion_rate
      FROM entry_base
      GROUP BY department
      ORDER BY total_tasks DESC, total_minutes DESC, department ASC
    `;

    const dailyTrendQuery = `
      WITH trend_base AS (
        SELECT
          e.id,
          e.work_date,
          e.completed,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE ($1::date IS NULL OR e.work_date >= $1::date)
          AND ($2::date IS NULL OR e.work_date <= $2::date)
          AND (
            $3::text IS NULL
            OR LOWER(COALESCE(u.department, '')) = LOWER($3::text)
            ${extendedSchema ? `
            OR EXISTS (
              SELECT 1
              FROM UNNEST(COALESCE(e.department_tags, ARRAY[]::text[])) AS tag
              WHERE LOWER(tag) = LOWER($3::text)
            )` : ''}
          )
        GROUP BY e.id, e.work_date, e.completed, e.start_time, e.end_time
      )
      SELECT
        work_date,
        COUNT(*)::int AS total_tasks,
        SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
        SUM(CASE WHEN completed THEN 0 ELSE 1 END)::int AS pending_tasks,
        SUM(total_minutes)::int AS total_minutes
      FROM trend_base
      GROUP BY work_date
      ORDER BY work_date DESC
      LIMIT 31
    `;

    const [employeeResult, departmentResult, dailyTrendResult] = await Promise.all([
      pool.query(employeeQuery, filters),
      pool.query(departmentQuery, filters),
      pool.query(dailyTrendQuery, filters)
    ]);

    const employeesRaw = employeeResult.rows;
    const departments = departmentResult.rows;
    const dailyTrend = dailyTrendResult.rows;
    const monitoredDays = daysBetweenInclusive(startDate, endDate);
    const maxTasks = Math.max(1, ...employeesRaw.map((row) => Number(row.total_tasks || 0)));
    const activeDaysBase = monitoredDays && monitoredDays > 0
      ? monitoredDays
      : Math.max(1, ...employeesRaw.map((row) => Number(row.active_days || 0)));

    const employees = employeesRaw.map((row) => {
      const totalTasks = Number(row.total_tasks || 0);
      const pendingTasks = Number(row.pending_tasks || 0);
      const completion = Number(row.completion_rate || 0);
      const throughput = Math.min(100, (totalTasks / maxTasks) * 100);
      const activeDays = Number(row.active_days || 0);
      const consistency = Math.min(100, (activeDays / Math.max(1, activeDaysBase)) * 100);
      const pendingPenalty = totalTasks > 0 ? (pendingTasks / totalTasks) * 100 : 0;
      const hybridBoost = totalTasks > 0 && (Number(row.hybrid_tasks || 0) / totalTasks) >= 0.3 ? 2 : 0;
      const score = Math.max(
        0,
        Math.min(
          100,
          (completion * 0.55)
          + (throughput * 0.2)
          + (consistency * 0.15)
          + ((100 - pendingPenalty) * 0.1)
          + hybridBoost
        )
      );

      return {
        ...row,
        performance_score: Number(score.toFixed(1)),
        score_level: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'average' : 'risk'
      };
    });

    const summary = employees.reduce((acc, row) => {
      acc.total_tasks += Number(row.total_tasks || 0);
      acc.completed_tasks += Number(row.completed_tasks || 0);
      acc.pending_tasks += Number(row.pending_tasks || 0);
      acc.total_minutes += Number(row.total_minutes || 0);
      acc.hybrid_tasks += Number(row.hybrid_tasks || 0);
      return acc;
    }, {
      total_employees: employees.length,
      total_tasks: 0,
      completed_tasks: 0,
      pending_tasks: 0,
      total_minutes: 0,
      hybrid_tasks: 0
    });

    const completionRate = summary.total_tasks > 0
      ? Number(((summary.completed_tasks / summary.total_tasks) * 100).toFixed(1))
      : 0;
    const avgDailyMinutes = monitoredDays && monitoredDays > 0
      ? Number((summary.total_minutes / monitoredDays).toFixed(1))
      : null;
    const alerts = employees
      .filter((row) => Number(row.total_tasks || 0) >= 5)
      .filter((row) =>
        Number(row.completion_rate || 0) < 55
        || Number(row.pending_tasks || 0) >= 5
        || Number(row.performance_score || 0) < 55
      )
      .map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name,
        home_department: row.home_department,
        completion_rate: Number(row.completion_rate || 0),
        performance_score: Number(row.performance_score || 0),
        pending_tasks: Number(row.pending_tasks || 0),
        total_tasks: Number(row.total_tasks || 0),
        total_minutes: Number(row.total_minutes || 0)
      }))
      .slice(0, 10);

    const rankedEmployees = [...employees]
      .sort((a, b) => {
        const scoreDiff = Number(b.performance_score || 0) - Number(a.performance_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const completionDiff = Number(b.completion_rate || 0) - Number(a.completion_rate || 0);
        if (completionDiff !== 0) return completionDiff;
        return Number(b.total_tasks || 0) - Number(a.total_tasks || 0);
      });

    const topPerformers = rankedEmployees.slice(0, 5);
    const bottomPerformers = [...employees]
      .filter((row) => Number(row.total_tasks || 0) >= 3)
      .sort((a, b) => {
        const scoreDiff = Number(a.performance_score || 0) - Number(b.performance_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.pending_tasks || 0) - Number(a.pending_tasks || 0);
      })
      .slice(0, 5);

    const strongestDepartment = [...departments]
      .filter((row) => Number(row.total_tasks || 0) >= 3)
      .sort((a, b) => {
        const rateDiff = Number(b.completion_rate || 0) - Number(a.completion_rate || 0);
        if (rateDiff !== 0) return rateDiff;
        return Number(b.total_tasks || 0) - Number(a.total_tasks || 0);
      })[0] || null;

    const busiestDay = [...dailyTrend]
      .sort((a, b) => Number(b.total_minutes || 0) - Number(a.total_minutes || 0))[0] || null;

    const riskLevel = alerts.length >= 8
      ? 'high'
      : alerts.length >= 4
        ? 'medium'
        : 'low';

    const recommendations = [];
    if (completionRate < 70) recommendations.push('Improve completion discipline with daily closure review.');
    if (summary.pending_tasks > summary.completed_tasks) recommendations.push('Pending workload is high; re-balance assignments across departments.');
    if (alerts.length > 0) recommendations.push('Schedule coaching for employees listed in Needs Attention.');
    if (Number(summary.hybrid_tasks || 0) > Number(summary.total_tasks || 0) * 0.4) {
      recommendations.push('Hybrid work is high; define ownership per task to reduce context switching.');
    }

    res.json({
      filters: {
        start_date: startDate,
        end_date: endDate,
        department: department || null
      },
      summary: {
        ...summary,
        completion_rate: completionRate,
        avg_daily_minutes: avgDailyMinutes,
        monitored_days: monitoredDays
      },
      employees,
      departments,
      daily_trend: dailyTrend,
      top_performers: topPerformers,
      bottom_performers: bottomPerformers,
      alerts,
      insights: {
        strongest_department: strongestDepartment,
        busiest_day: busiestDay,
        risk_level: riskLevel,
        recommendations
      }
    });
  } catch (error) {
    console.error('Error fetching office performance summary:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Department-wise monthly KPI target vs actual
 */
const getWorkKpiTargets = async (req, res) => {
  try {
    const extendedSchema = await ensureOfficeWorkPerformanceSchema();
    const kpiSchemaReady = await ensureOfficeWorkKpiSchema();
    if (!canViewOfficeWorkPerformance(req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const monthKey = normalizeMonthParam(req.query.month) || getCurrentMonthKey();
    if (monthKey === '__invalid__') {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    const deptResult = await pool.query(`
      SELECT DISTINCT dept_name AS department
      FROM departments
      WHERE TRIM(COALESCE(dept_name, '')) <> ''
      ORDER BY dept_name ASC
    `);
    const departments = deptResult.rows.map((r) => r.department);

    const targetResult = kpiSchemaReady
      ? await pool.query(
        `
          SELECT
            department,
            task_target,
            completion_target,
            minutes_target,
            updated_at
          FROM office_work_kpi_targets
          WHERE month_key = $1
        `,
        [monthKey]
      )
      : { rows: [] };

    const targetMap = new Map(
      targetResult.rows.map((row) => [String(row.department || '').trim().toLowerCase(), row])
    );

    const actualQuery = extendedSchema ? `
      WITH base AS (
        SELECT
          e.id,
          e.completed,
          COALESCE(
            NULLIF(SUM(s.duration_minutes), 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )::int AS total_minutes,
          COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS home_department,
          COALESCE(e.department_tags, ARRAY[]::text[]) AS department_tags
        FROM office_work_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN office_work_sessions s ON s.entry_id = e.id
        WHERE to_char(e.work_date, 'YYYY-MM') = $1
        GROUP BY e.id, e.completed, e.start_time, e.end_time, u.department, e.department_tags
      ),
      expanded AS (
        SELECT
          b.id,
          b.completed,
          b.total_minutes,
          COALESCE(NULLIF(TRIM(x.tag), ''), b.home_department) AS department
        FROM base b
        LEFT JOIN LATERAL (
          SELECT UNNEST(
            CASE
              WHEN COALESCE(array_length(b.department_tags, 1), 0) > 0 THEN b.department_tags
              ELSE ARRAY[b.home_department]
            END
          ) AS tag
        ) x ON TRUE
      )
      SELECT
        department,
        COUNT(DISTINCT id)::int AS total_tasks,
        SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_tasks,
        SUM(total_minutes)::int AS total_minutes
      FROM expanded
      GROUP BY department
    ` : `
      SELECT
        COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned') AS department,
        COUNT(DISTINCT e.id)::int AS total_tasks,
        SUM(CASE WHEN e.completed THEN 1 ELSE 0 END)::int AS completed_tasks,
        SUM(
          COALESCE(
            NULLIF(s.session_minutes, 0),
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)::int)
          )
        )::int AS total_minutes
      FROM office_work_entries e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN (
        SELECT entry_id, SUM(duration_minutes)::int AS session_minutes
        FROM office_work_sessions
        GROUP BY entry_id
      ) s ON s.entry_id = e.id
      WHERE to_char(e.work_date, 'YYYY-MM') = $1
      GROUP BY COALESCE(NULLIF(TRIM(u.department), ''), 'Unassigned')
    `;
    const actualResult = await pool.query(actualQuery, [monthKey]);
    const actualMap = new Map(
      actualResult.rows.map((row) => [String(row.department || '').trim().toLowerCase(), row])
    );

    const unionDepartments = [...new Set([
      ...departments,
      ...targetResult.rows.map((r) => r.department),
      ...actualResult.rows.map((r) => r.department)
    ])]
      .map((d) => String(d || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const rows = unionDepartments.map((department) => {
      const key = department.toLowerCase();
      const target = targetMap.get(key);
      const actual = actualMap.get(key) || {};
      const taskTarget = Number(target?.task_target || 0);
      const completionTarget = Number(target?.completion_target || 80);
      const minutesTarget = Number(target?.minutes_target || 0);
      const actualTasks = Number(actual.total_tasks || 0);
      const actualCompleted = Number(actual.completed_tasks || 0);
      const actualMinutes = Number(actual.total_minutes || 0);
      const actualCompletion = actualTasks > 0 ? (actualCompleted / actualTasks) * 100 : 0;
      const taskPct = taskTarget > 0 ? (actualTasks / taskTarget) * 100 : null;
      const minutesPct = minutesTarget > 0 ? (actualMinutes / minutesTarget) * 100 : null;

      const onTrack = (taskPct === null || taskPct >= 90) && actualCompletion >= Math.max(0, completionTarget - 5);
      const atRisk = !onTrack && ((taskPct !== null && taskPct >= 70) || actualCompletion >= Math.max(0, completionTarget - 15));
      const status = onTrack ? 'on_track' : atRisk ? 'at_risk' : 'off_track';

      return {
        department,
        target: {
          tasks: taskTarget,
          completion_rate: completionTarget,
          minutes: minutesTarget,
          updated_at: target?.updated_at || null
        },
        actual: {
          tasks: actualTasks,
          completed_tasks: actualCompleted,
          completion_rate: Number(actualCompletion.toFixed(1)),
          minutes: actualMinutes
        },
        achievement: {
          tasks_pct: taskPct === null ? null : Number(taskPct.toFixed(1)),
          minutes_pct: minutesPct === null ? null : Number(minutesPct.toFixed(1)),
          completion_gap: Number((actualCompletion - completionTarget).toFixed(1)),
          status
        }
      };
    });

    res.json({
      month: monthKey,
      rows,
      kpi_storage_enabled: Boolean(kpiSchemaReady)
    });
  } catch (error) {
    console.error('Error fetching office KPI targets:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const upsertWorkKpiTarget = async (req, res) => {
  try {
    const kpiSchemaReady = await ensureOfficeWorkKpiSchema();
    if (!canViewOfficeWorkPerformance(req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!kpiSchemaReady) {
      return res.status(200).json({
        saved: false,
        kpi_storage_enabled: false,
        message: 'KPI target storage unavailable (view-only mode)'
      });
    }

    const month = normalizeMonthParam(req.body?.month);
    const department = String(req.body?.department || '').trim();
    const taskTarget = Number(req.body?.task_target || 0);
    const completionTarget = Number(req.body?.completion_target || 0);
    const minutesTarget = Number(req.body?.minutes_target || 0);

    if (!month || month === '__invalid__') {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }
    if (!department) {
      return res.status(400).json({ message: 'Department is required' });
    }
    if (!Number.isFinite(taskTarget) || taskTarget < 0) {
      return res.status(400).json({ message: 'task_target must be a non-negative number' });
    }
    if (!Number.isFinite(completionTarget) || completionTarget < 0 || completionTarget > 100) {
      return res.status(400).json({ message: 'completion_target must be between 0 and 100' });
    }
    if (!Number.isFinite(minutesTarget) || minutesTarget < 0) {
      return res.status(400).json({ message: 'minutes_target must be a non-negative number' });
    }

    const result = await pool.query(
      `
        INSERT INTO office_work_kpi_targets (
          month_key, department, task_target, completion_target, minutes_target, updated_by, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (month_key, department)
        DO UPDATE SET
          task_target = EXCLUDED.task_target,
          completion_target = EXCLUDED.completion_target,
          minutes_target = EXCLUDED.minutes_target,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *
      `,
      [month, department, taskTarget, completionTarget, minutesTarget, Number(req.user?.id || 0) || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error upserting office KPI target:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getWorkEntries,
  addWorkEntry,
  updateWorkEntry,
  toggleWorkEntry,
  deleteWorkEntry,
  addWorkSession,
  getWorkPerformanceSummary,
  getWorkKpiTargets,
  upsertWorkKpiTarget
};
