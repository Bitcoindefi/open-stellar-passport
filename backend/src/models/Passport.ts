import mongoose, { Schema, Document } from "mongoose";

export interface IPassport extends Document {
  passportId: string;
  agentId: string;
  status: "active" | "suspended" | "revoked";
}

const PassportSchema = new Schema<IPassport>(
  {
    passportId: { type: String, required: true, unique: true, index: true },
    agentId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["active", "suspended", "revoked"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IPassport>("Passport", PassportSchema);