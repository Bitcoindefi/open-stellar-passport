import mongoose, { Schema, Document } from "mongoose";

export interface IAppeal extends Document {
  appealId: string;
  passportId: string;
  agentId: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  note?: string;
}

const AppealSchema = new Schema<IAppeal>(
  {
    appealId: { type: String, required: true, unique: true, index: true },
    passportId: { type: String, required: true, index: true },
    agentId: { type: String, required: true, index: true },
    reason: { type: String, required: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    note: { type: String },
  },
  { timestamps: true }
);

// Compound index: one pending appeal per passport
AppealSchema.index(
  { passportId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export default mongoose.model<IAppeal>("Appeal", AppealSchema);