const pool = require('./db');

let initPromise;

const ensureEmployeeOfTheMonthTable = () => {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS employee_of_the_month_awards (
        id BIGSERIAL PRIMARY KEY,
        award_month DATE NOT NULL UNIQUE CHECK (EXTRACT(DAY FROM award_month) = 1),
        employee_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        employee_name VARCHAR(200) NOT NULL,
        certificate_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
};

module.exports = { ensureEmployeeOfTheMonthTable };
