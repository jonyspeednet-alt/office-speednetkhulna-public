const pool = require("../../utilities/db");

/**
 * Get Reseller Status for NOC view
 * Returns bandwidth data for active/inactive resellers
 */
const getStatusNoc = async (req, res) => {
    try {
        const { status = 'active' } = req.query;
        
        const result = await pool.query(`
            SELECT
                id,
                reseller_name AS name,
                company_name,
                contact_no AS phone,
                iig_bw,
                bdix_bw,
                ggc_bw,
                fna_bw,
                cdn_bw,
                bcdn_bw,
                nttn_capacity,
                pop_location,
                status,
                COALESCE(partner_type, 'distribution_partner') AS partner_type
            FROM
                resellers
            WHERE
                status = $1
            ORDER BY
                iig_bw DESC, reseller_name ASC
        `, [status]);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching NOC status:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = {
    getStatusNoc
};