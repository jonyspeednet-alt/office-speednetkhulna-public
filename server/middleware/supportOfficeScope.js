const pool = require('../utilities/db');
const { BRANCHES, normalizeOfficeName } = require('../constants/branches');

const resolveSupportOffice = (user) => {
  const rawOffice = String(user?.work_location || '').trim();
  if (!rawOffice) return null;

  const office = normalizeOfficeName(rawOffice);
  const branch = BRANCHES.find((item) => item.name === office);
  if (!branch) return null;

  return { office: branch.name, isHeadOffice: branch.code === 'CO' };
};

const officeAliases = (office) => {
  const branch = BRANCHES.find((item) => item.name === office);
  return branch ? [branch.name, ...branch.aliases].map((value) => value.trim().toLowerCase()) : [];
};

const appendSupportOfficeScope = (where, params, scope, alias = 't') => {
  if (scope.isHeadOffice) return;

  const branchValues = officeAliases(scope.office);
  const headOfficeValues = officeAliases('Corporate Office');
  params.push(branchValues, headOfficeValues);
  const branchParam = params.length - 1;
  const headOfficeParam = params.length;
  where.push(`(
    LOWER(TRIM(COALESCE(NULLIF(${alias}.office_name, ''), NULLIF(${alias}.zone, ''), 'Corporate Office'))) = ANY($${branchParam}::text[])
    OR (
      LOWER(TRIM(COALESCE(${alias}.office_name, ''))) = ANY($${headOfficeParam}::text[])
      AND LOWER(TRIM(COALESCE(${alias}.zone, ''))) = ANY($${branchParam}::text[])
    )
  )`);
};

const requireSupportOffice = (req, res, next) => {
  const scope = resolveSupportOffice(req.user);
  if (!scope) {
    return res.status(403).json({
      success: false,
      message: 'Your work location is not configured for support ticket access.',
    });
  }
  req.supportOfficeScope = scope;
  return next();
};

const requireSupportOfficeTicket = async (req, res, next) => {
  try {
    const scope = req.supportOfficeScope || resolveSupportOffice(req.user);
    if (!scope) {
      return res.status(403).json({
        success: false,
        message: 'Your work location is not configured for support ticket access.',
      });
    }
    req.supportOfficeScope = scope;
    if (scope.isHeadOffice) return next();

    const ticketId = req.params.id || req.body?.ticket_id;
    if (!ticketId || !/^\d+$/.test(String(ticketId))) {
      return res.status(400).json({ success: false, message: 'Invalid ticket ID.' });
    }
    const result = await pool.query(
      'SELECT office_name, zone FROM support_tickets WHERE id=$1',
      [ticketId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    const ticket = result.rows[0];
    let ticketOffice = normalizeOfficeName(ticket.office_name || ticket.zone);
    const ticketZone = normalizeOfficeName(ticket.zone);
    if (ticketOffice === 'Corporate Office' && ticketZone !== 'Corporate Office') {
      ticketOffice = ticketZone;
    }
    if (ticketOffice !== scope.office) {
      return res.status(403).json({ success: false, message: 'Access denied for this office ticket.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  resolveSupportOffice,
  appendSupportOfficeScope,
  requireSupportOffice,
  requireSupportOfficeTicket,
};
