const pool = require('../utilities/db');

/**
 * Get Active Notice
 * Replaces static content in notice_ticker.php
 */
const getActiveNotice = async (req, res) => {
  try {
    // For migration parity, using the static text from the PHP file.
    // In the future, you can replace this with a DB query: SELECT content FROM notices WHERE active = true
    const notice = "New update: staff can now change their own password from their profile. | Office hours: 09:30 AM to 07:30 PM. | For urgent needs, contact admin.";
    
    res.json({ notice });
  } catch (error) {
    console.error('Notice Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getActiveNotice };