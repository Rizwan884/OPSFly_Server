const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    industry: {
      type: String,
      enum: ['Restaurant', 'Hotel', 'Other'],
      default: 'Restaurant',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Organization || mongoose.model('Organization', organizationSchema);
