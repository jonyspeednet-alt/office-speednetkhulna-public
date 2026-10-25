const pool = require("../../utilities/db");

const getPackagesByReseller = async (req, res) => {
    try {
        const { resellerId } = req.params;
        const result = await pool.query("SELECT * FROM packages WHERE reseller_id = $1 ORDER BY id", [resellerId]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const createPackage = async (req, res) => {
    try {
        const { reseller_id, name, monthly_mrc, status } = req.body;
        const result = await pool.query(
            "INSERT INTO packages (reseller_id, name, monthly_mrc, status) VALUES ($1, $2, $3, $4) RETURNING *",
            [reseller_id, name, monthly_mrc, status]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const updatePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, monthly_mrc, status } = req.body;
        const result = await pool.query(
            "UPDATE packages SET name = $1, monthly_mrc = $2, status = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
            [name, monthly_mrc, status, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const deletePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query("DELETE FROM packages WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

module.exports = {
    getPackagesByReseller,
    createPackage,
    updatePackage,
    deletePackage
};