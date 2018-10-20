export { default as DiscordSessionObserver } from './sessionObserver'
export { default as discordInviteMiddleware } from './inviteMiddleware'

import { avatarRegistry } from '../../services/avatar'
const { ipcRenderer } = chrome

const DISCORD_CDN = 'https://cdn.discordapp.com/'
const DISCORD_AVATAR_TYPE = 'discord'

/** https://discordapp.com/developers/docs/reference#snowflakes */
function isSnowflake(id: string) {
  return typeof id === 'string' && /\d+/.test(id)
}

function initAvatar() {
  avatarRegistry.registerType(DISCORD_AVATAR_TYPE, (userId: string, userAvatar: string) => {
    if (isSnowflake(userId) && typeof userAvatar === 'string') {
      return `${DISCORD_CDN}avatars/${userId}/${userAvatar}.png`
    }
  })

  // Register discord user avatar upon login
  ipcRenderer.on('discord-user', (event: Electron.Event, user: any) => {
    const { id, avatar } = user

    if (id && avatar) {
      avatarRegistry.register({
        type: DISCORD_AVATAR_TYPE,
        params: [id, avatar]
      })
    }
  })
}

initAvatar()