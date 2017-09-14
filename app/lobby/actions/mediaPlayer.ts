import { actionCreator } from 'utils/redux';
import { IMediaItem } from 'lobby/reducers/mediaPlayer';
import { Thunk } from 'types/thunk';
import { ThunkAction } from 'redux-thunk';
import { ILobbyNetState } from 'lobby';
import { rpc, RpcRealm } from 'network/middleware/rpc';
import { RpcThunk } from 'lobby/types';
import { PlatformService } from 'platform';
import { getServiceForUrl } from 'media';
import { MediaThumbnailSize } from 'services/types';

export const setMedia = actionCreator<IMediaItem>('SET_MEDIA');
export const endMedia = actionCreator<void>('END_MEDIA');

const requestMedia = (url: string): RpcThunk<void> => async (dispatch, getState, context) => {
  const service = getServiceForUrl(url);
  if (!service) {
    // TODO: tell client the service is unsupported
    console.error('Unsupported service for', url);
    return;
  }

  let result;

  try {
    result = await service.resolve(url);
  } catch (e) {
    console.error(`Failed to fetch media URL metadata`);
    console.error(e);
    return;
  }

  console.log('Service result', result);

  const userId = context.client.id;
  const media: IMediaItem = {
    url: result.url,
    title: result.title,
    duration: result.duration,
    imageUrl: result.thumbnails[MediaThumbnailSize.Default],
    ownerId: userId.toString(),
    ownerName: PlatformService.getUserName(userId)
  };

  dispatch(setMedia(media));
};
export const server_requestMedia = rpc(RpcRealm.Server, requestMedia);