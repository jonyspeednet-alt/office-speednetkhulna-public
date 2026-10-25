const pool = require("../../utilities/db");
const { getActor, getReqMeta } = require("../../utilities/resellerFinancialAudit");


const createReseller = async (req, res) => {
    try {
        const { name, contact_person, contact_number, email, address, status } = req.body;
        const actor = getActor(req);
        const reqMeta = getReqMeta(req);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const newReseller = await client.query(
                "INSERT INTO resellers (name, contact_person, contact_number, email, address, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [name, contact_person, contact_number, email, address, status]
            );
            const resellerId = newReseller.rows[0].id;

            await client.query(
                `INSERT INTO reseller_financial_audit_log (reseller_id, action, actor_id, actor_name, actor_role, changed_data, ip, user_agent)
                 VALUES ($1, 'create', $2, $3, $4, $5, $6, $7)`,
                [resellerId, actor.actorId, actor.actorName, actor.role, { after: newReseller.rows[0] }, reqMeta.ip, reqMeta.ua]
            );

            await client.query("COMMIT");
            res.status(201).json(newReseller.rows[0]);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const getResellers = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM resellers ORDER BY name");
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const getResellerById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query("SELECT * FROM resellers WHERE id = $1", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Reseller not found" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

const updateReseller = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, contact_person, contact_number, email, address, status } = req.body;
        const actor = getActor(req);
        const reqMeta = getReqMeta(req);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const oldReseller = await client.query("SELECT * FROM resellers WHERE id = $1 FOR UPDATE", [id]);
            if (oldReseller.rows.length === 0) {
                return res.status(404).json({ message: "Reseller not found" });
            }

            const updatedReseller = await client.query(
                "UPDATE resellers SET name = $1, contact_person = $2, contact_number = $3, email = $4, address = $5, status = $6, updated_at = NOW() WHERE id = $7 RETURNING *",
                [name, contact_person, contact_number, email, address, status, id]
            );

            await client.query(
                `INSERT INTO reseller_financial_audit_log (reseller_id, action, actor_id, actor_name, actor_role, changed_data, ip, user_agent)
                 VALUES ($1, 'update', $2, $3, $4, $5, $6, $7)`,
                [id, actor.actorId, actor.actorName, actor.role, { before: oldReseller.rows[0], after: updatedReseller.rows[0] }, reqMeta.ip, reqMeta.ua]
            );

            await client.query("COMMIT");
            res.json(updatedReseller.rows[0]);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};


module.exports = {
    createReseller,
    getResellers,
    getResellerById,
    updateReseller
};