const Location = require('../models/Location');
const User = require('../models/User');

async function getUserAccessibleLocationIds(user) {
  if (!user) return [];
  
  const role = user.role;
  
  if (role === 'owner') {
    if (!user.organizationId) return [];
    const locations = await Location.find({ organizationId: user.organizationId }).select('_id');
    return locations.map(l => l._id.toString());
  }
  
  if (!user.locationIds || user.locationIds.length === 0) return [];
  return user.locationIds.map(id => id.toString());
}

async function verifyLocationAccess(req, res, decodedUser) {
  const reqLocationId = req.headers['x-location-id'] || req.query.locationId;
  
  const user = await User.findById(decodedUser.userId || decodedUser.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  
  if (user.isActive === false || user.deleted === true) {
    res.status(403).json({ error: 'Unauthorized. Account is inactive or deactivated.' });
    return null;
  }
  
  const accessibleLocationIds = await getUserAccessibleLocationIds(user);
  
  if (accessibleLocationIds.length === 0) {
    res.status(403).json({ error: 'User does not have access to any locations' });
    return null;
  }
  
  let selectedLocationId = reqLocationId;
  
  if (!selectedLocationId) {
    selectedLocationId = accessibleLocationIds[0];
  }
  
  if (!accessibleLocationIds.includes(selectedLocationId.toString())) {
    res.status(403).json({ error: 'Forbidden. You do not have access to this location.' });
    return null;
  }
  
  return {
    selectedLocationId,
    organizationId: user.organizationId,
    user,
    accessibleLocationIds
  };
}

module.exports = {
  getUserAccessibleLocationIds,
  verifyLocationAccess
};
