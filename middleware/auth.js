const jwt = require("jsonwebtoken");
require("dotenv").config();

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Authentication failed: No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Authentication failed: Invalid token." });
  }
};

/**
 * Updated authorize middleware that works with your token structure
 * Uses the 'type' field for authorization since 'roles' is only for superadmin
 */
const authorize = (...allowedTypes) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(403)
        .json({ message: "Forbidden: No user information found." });
    }

    // Infer user type from token if missing or inconsistent
    let userType = req.user.type;
    if (!userType && Array.isArray(req.user.roles)) {
      const roleNames = req.user.roles.map(r => (typeof r === 'object' ? r.name : r));
      if (roleNames.includes('driver')) userType = 'driver';
      else if (roleNames.includes('passenger')) userType = 'passenger';
      else if (roleNames.includes('admin') || roleNames.includes('superadmin')) userType = 'admin';
      req.user.type = userType;
    }

    // If an endpoint allows admin, also allow superadmin
    if (allowedTypes.includes("admin") && (userType === "admin" || userType === "superadmin")) {
      return next();
    }

    // For superadmin, we need to check the roles array
    if (
      userType === "admin" &&
      Array.isArray(req.user.roles) &&
      req.user.roles.length > 0
    ) {
      const userRoleNames = req.user.roles.map((role) =>
        typeof role === "object" ? role.name : role
      );

      // If user has superadmin role, allow access to admin endpoints
      if (
        userRoleNames.includes("superadmin") &&
        allowedTypes.includes("admin")
      ) {
        return next();
      }
    }

    // For all other users, check the type field directly
    if (allowedTypes.includes(userType)) {
      next();
    } else {
      return res.status(403).json({
        message:
          "Forbidden: You do not have permission to access this resource.",
      });
    }
  };
};

module.exports = {
  authenticate,
  authorize,
};
