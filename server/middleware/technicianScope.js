// Field-technician scoping for the mobile app (and any API client).
//
// A "field technician" = user who holds support.ticket.update but NOT
// support.ticket.assign (and is not super admin). The seeded `Technician`
// role (see utilities/supportInit.js ensureTechnicianRole) grants exactly
// view + update, so techs land here automatically. Granting a tech the
// `assign` permission graduates them out of this scope with no code change.
const pool = require('../utilities/db');
const { fail, notFound, serverError } = require('../utilities/apiResponse');
const { resolvePermission, isSuperAdmin } = require('../utilities/permissionRegistry');

const isFieldTechnician = (user) => {
  if (!user) return false;
  if (isSuperAdmin(user)) return false;
  const canUpdate = resolvePermission(user, 'support.ticket.update');
  const canAssign = resolvePermission(user, 'support.ticket.assign');
  return canUpdate && !canAssign;
};

// Route guard for /tickets/:id endpoints: field technicians may only touch
// tickets currently assigned to themselves. Everyone else passes through.
const requireOwnTicket = async (req, res, next) => {
  try {
    if (!isFieldTechnician(req.user)) return next();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return fail(res, 'Invalid ticket ID', 400);
    const r = await pool.query('SELECT assigned_to FROM support_tickets WHERE id=$1', [id]);
    if (!r.rowCount) return notFound(res, 'Ticket not found');
    if (Number(r.rows[0].assigned_to) !== Number(req.user.id)) {
      return fail(res, 'Access denied: ticket is not assigned to you', 403);
    }
    return next();
  } catch (error) { return serverError(res, error); }
};

// Hard block for actions technicians must never perform (delete, verification
// calls). Used inside controllers where no :id ownership check applies.
const blockFieldTechnician = (req, res) => {
  if (isFieldTechnician(req.user)) {
    fail(res, 'Access denied for field technicians', 403);
    return true;
  }
  return false;
};

module.exports = { isFieldTechnician, requireOwnTicket, blockFieldTechnician };
