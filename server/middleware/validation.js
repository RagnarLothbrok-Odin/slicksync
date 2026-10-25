const Joi = require("joi");

const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({
            details: error.details.map((detail) => detail.message),
            message: "Validation error",
        });
    }
    next();
};

// Validation schemas
const registerSchema = Joi.object({
    email: Joi.string().email().required(),
    firstName: Joi.string().min(1).max(50).optional(),
    lastName: Joi.string().min(1).max(50).optional(),
    password: Joi.string().min(6).required(),
    username: Joi.string().alphanum().min(3).max(30).required(),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
});

const createGroupSchema = Joi.object({
    colorIndex: Joi.number().integer().min(1).max(5).optional(),
    description: Joi.string().max(500).optional(),
    maxUsers: Joi.number().integer().min(2).max(50).optional(),
    name: Joi.string().min(1).max(100).required(),
});

const updateGroupSchema = Joi.object({
    colorIndex: Joi.number().integer().min(1).max(5).optional(),
    description: Joi.string().max(500).optional().allow(""),
    maxUsers: Joi.number().integer().min(2).max(50).optional(),
    name: Joi.string().min(1).max(100).optional(),
});

const inviteUserSchema = Joi.object({
    email: Joi.string().email().required(),
    role: Joi.string().valid("ADMIN", "MODERATOR", "MEMBER").optional(),
});

const addAddonSchema = Joi.object({
    author: Joi.string().max(100).optional(),
    category: Joi.string().max(50).optional(),
    description: Joi.string().max(500).optional(),
    iconUrl: Joi.string().uri().optional(),
    manifestUrl: Joi.string().uri().required(),
    name: Joi.string().min(1).max(100).required(),
    version: Joi.string().max(20).optional(),
});

const updateAddonSettingsSchema = Joi.object({
    isEnabled: Joi.boolean().optional(),
    settings: Joi.object().optional(),
});

const updateUserSchema = Joi.object({
    firstName: Joi.string().min(1).max(50).optional(),
    lastName: Joi.string().min(1).max(50).optional(),
    username: Joi.string().alphanum().min(3).max(30).optional(),
});

const changePasswordSchema = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
});

module.exports = {
    addAddonSchema,
    changePasswordSchema,
    createGroupSchema,
    inviteUserSchema,
    loginSchema,
    registerSchema,
    updateAddonSettingsSchema,
    updateGroupSchema,
    updateUserSchema,
    validate,
};
