import {
  deleteAllInfosFromUserId,
  deleteAllOrphanTracks,
  deleteUser as dbDeleteUser,
} from "../database";
import { ImportMappingModel, ImportReviewModel } from "../database/Models";
import { longWriteDbLock } from "./lock";
import { logger } from "./logger";

export const deleteUser = async (userId: string) => {
  logger.info(`Deleting user ${userId}`);
  await longWriteDbLock.lock();
  await deleteAllInfosFromUserId(userId);
  await ImportMappingModel.deleteMany({ owner: userId });
  await ImportReviewModel.deleteMany({ owner: userId });
  await dbDeleteUser(userId);
  await deleteAllOrphanTracks();
  longWriteDbLock.unlock();
};
