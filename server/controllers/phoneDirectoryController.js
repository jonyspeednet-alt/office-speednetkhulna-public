const pool = require('../utilities/db');

// Escape LIKE wildcards so search input can't inject %/_ patterns
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

/**
 * Get Phone Directory Data (Paginated & Searchable)
 */
const getPhones = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let queryParams = [];
    let whereClause = '';

    if (search) {
      whereClause = `
        WHERE op.desk_name ILIKE $1 ESCAPE '\\' OR u.full_name ILIKE $1 ESCAPE '\\'
        OR op.extension ILIKE $1 ESCAPE '\\' OR op.phone_number ILIKE $1 ESCAPE '\\'
      `;
      queryParams.push(`%${escapeLike(search)}%`);
    }

    // Count Total
    const countQuery = `
      SELECT COUNT(*) 
      FROM office_phones op 
      LEFT JOIN users u ON op.assign_to::text = u.id::text
      ${whereClause}
    `;
    const countRes = await pool.query(countQuery, queryParams);
    const totalRecords = parseInt(countRes.rows[0].count);

    // Fetch Data
    const dataQuery = `
      SELECT op.*, u.full_name, u.profile_pic, u.designation, u.employee_id as emp_id 
      FROM office_phones op 
      LEFT JOIN users u ON op.assign_to::text = u.id::text
      ${whereClause}
      ORDER BY op.desk_name ASC 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    
    const dataParams = [...queryParams, limit, offset];
    const dataRes = await pool.query(dataQuery, dataParams);

    res.json({
      phones: dataRes.rows,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      currentPage: page
    });

  } catch (error) {
    console.error('Get Phones Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * Add New Phone
 */
const addPhone = async (req, res) => {
  try {
    const { desk_name, assign_to, extension, phone_number, device_model, ip_address } = req.body;
    
    const query = `
      INSERT INTO office_phones (desk_name, assign_to, extension, phone_number, device_model, ip_address) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `;
    await pool.query(query, [desk_name, assign_to, extension, phone_number, device_model, ip_address]);
    
    res.status(201).json({ message: 'Phone added successfully' });
  } catch (error) {
    console.error('Add Phone Error:', error);
    res.status(500).json({ message: 'Failed to add phone' });
  }
};

/**
 * Update Phone
 */
const updatePhone = async (req, res) => {
  try {
    const { id } = req.params;
    const { desk_name, assign_to, extension, phone_number, device_model, ip_address } = req.body;

    const query = `
      UPDATE office_phones 
      SET desk_name=$1, assign_to=$2, extension=$3, phone_number=$4, device_model=$5, ip_address=$6 
      WHERE id=$7
    `;
    await pool.query(query, [desk_name, assign_to, extension, phone_number, device_model, ip_address, id]);

    res.json({ message: 'Phone updated successfully' });
  } catch (error) {
    console.error('Update Phone Error:', error);
    res.status(500).json({ message: 'Failed to update phone' });
  }
};

/**
 * Delete Phone
 */
const deletePhone = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM office_phones WHERE id = $1', [id]);
    res.json({ message: 'Phone deleted successfully' });
  } catch (error) {
    console.error('Delete Phone Error:', error);
    res.status(500).json({ message: 'Failed to delete phone' });
  }
};

/**
 * Export CSV
 */
const exportPhones = async (req, res) => {
  try {
    const search = req.query.search || '';
    let queryParams = [];
    let whereClause = '';

    if (search) {
      whereClause = `
        WHERE op.desk_name ILIKE $1 ESCAPE '\\' OR u.full_name ILIKE $1 ESCAPE '\\'
        OR op.extension ILIKE $1 ESCAPE '\\' OR op.phone_number ILIKE $1 ESCAPE '\\'
      `;
      queryParams.push(`%${escapeLike(search)}%`);
    }

    const query = `
      SELECT op.desk_name, COALESCE(u.full_name, CAST(op.assign_to AS VARCHAR)) as assign_name, 
             op.extension, op.phone_number, op.device_model, op.ip_address 
      FROM office_phones op 
      LEFT JOIN users u ON op.assign_to::text = u.id::text
      ${whereClause}
      ORDER BY op.desk_name ASC
    `;
    
    const result = await pool.query(query, queryParams);
    
    // Generate CSV String
    const headers = ['Desk Name', 'Assign To', 'Extension', 'Phone Number', 'Device Model', 'IP Address'];
    let csv = headers.join(',') + '\n';
    
    result.rows.forEach(row => {
      // OWASP CSV injection: neutralize leading =,+,-,@,tab,CR
      const safe = (v) => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const values = [
        safe(row.desk_name),
        safe(row.assign_name),
        safe(row.extension),
        safe(row.phone_number),
        safe(row.device_model),
        safe(row.ip_address)
      ];
      csv += values.join(',') + '\n';
    });

    res.header('Content-Type', 'text/csv');
    res.attachment(`phone_directory_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Export Error:', error);
    res.status(500).json({ message: 'Export failed' });
  }
};

/**
 * Get Users for Dropdown
 */
const getUsersForDropdown = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, full_name, designation, employee_id FROM users ORDER BY full_name ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
};

module.exports = { getPhones, addPhone, updatePhone, deletePhone, exportPhones, getUsersForDropdown };
