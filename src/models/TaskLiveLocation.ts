import mongoose, { Schema, Model, Document } from 'mongoose';

export interface ITaskLiveLocation extends Document {
  taskId: mongoose.Types.ObjectId;
  partnerId: mongoose.Types.ObjectId;
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  source: 'socket';
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TaskLiveLocationSchema = new Schema<ITaskLiveLocation>(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      unique: true,
      index: true,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    accuracy: {
      type: Number,
      default: null,
    },
    heading: {
      type: Number,
      default: null,
    },
    speed: {
      type: Number,
      default: null,
    },
    source: {
      type: String,
      enum: ['socket'],
      default: 'socket',
    },
    recordedAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

TaskLiveLocationSchema.index({ partnerId: 1, recordedAt: -1 });
TaskLiveLocationSchema.index({ taskId: 1, partnerId: 1 });

const TaskLiveLocation: Model<ITaskLiveLocation> =
  mongoose.models.TaskLiveLocation ||
  mongoose.model<ITaskLiveLocation>('TaskLiveLocation', TaskLiveLocationSchema);

export default TaskLiveLocation;
