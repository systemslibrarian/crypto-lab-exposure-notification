/**
 * Exhibit 6 — the metadata is malleable.
 *
 * Break-it-yourself against the real cipher: the learner flips a bit of the
 * ciphertext and the page decrypts it with the genuine AES-CTR call. No error
 * is raised anywhere, because there is nothing in the format that could raise
 * one. The ABSENCE of a failure code is the exhibit.
 */

import {
  aemKey,
  associatedEncryptedMetadata,
  decodeMetadata,
  encodeMetadata,
  metadataVersion,
  rollingProximityId,
  rpiKey,
} from '../crypto/gaen'
import { fromHex, toHex } from '../crypto/bytes'
import { GAEN_SCHEDULE } from '../crypto/vectors'
import { callout, details, el, hexBlock, kv, list, mount, para, verdict } from './render'

interface State {
  /** Which bit of which ciphertext byte is flipped, or null for untouched. */
  flip: { byte: number; bit: number } | null
}

const state: State = { flip: null }

const TEK = fromHex(GAEN_SCHEDULE.tek)

export async function render(host: HTMLElement): Promise<void> {
  const rpik = (await rpiKey(TEK)).okm
  const aemk = (await aemKey(TEK)).okm
  const rpi = await rollingProximityId(rpik, GAEN_SCHEDULE.startInterval)

  const plain = encodeMetadata({ versionByte: 0x40, txPowerDbm: -8 })
  const honest = await associatedEncryptedMetadata(aemk, rpi, plain)

  const onAir = Uint8Array.from(honest)
  if (state.flip) {
    onAir[state.flip.byte] = (onAir[state.flip.byte] as number) ^ state.flip.bit
  }
  const received = await associatedEncryptedMetadata(aemk, rpi, onAir)
  const readingBefore = decodeMetadata(plain)
  const readingAfter = decodeMetadata(received)
  const tampered = state.flip !== null

  const flipBtn = el('button', {
    type: 'button',
    class: 'primary',
    id: 'ex6-flip',
    text: 'Flip bit 0x10 of ciphertext byte 1',
  })
  flipBtn.addEventListener('click', () => {
    state.flip = { byte: 1, bit: 0x10 }
    void render(host)
  })

  const flipVersion = el('button', { type: 'button', id: 'ex6-flip-version', text: 'Flip the version byte instead' })
  flipVersion.addEventListener('click', () => {
    state.flip = { byte: 0, bit: 0x40 }
    void render(host)
  })

  const resetBtn = el('button', { type: 'button', id: 'ex6-reset', text: 'Send it untouched' })
  resetBtn.addEventListener('click', () => {
    state.flip = null
    void render(host)
  })

  const powerShift = readingAfter.txPowerDbm - readingBefore.txPowerDbm

  mount(
    host,
    el('h2', { text: '6. The metadata is encrypted, not protected' }),
    para(
      'Four bytes travel beside every identifier, and one of them is the transmit power a receiver uses to guess how far away the sender was. They are encrypted with AES-128 in counter mode. Counter mode is a stream cipher: flip a bit of the ciphertext and you flip exactly that bit of the plaintext. There is no tag, no padding and no length field, so there is nothing that can notice.',
      'lede',
    ),

    el('div', { class: 'btn-row' }, [flipBtn, flipVersion, resetBtn]),

    kv([
      ['AEMK', hexBlock(aemk)],
      ['Counter block (the RPI)', hexBlock(rpi)],
      ['Honest ciphertext', hexBlock(honest)],
      ['On the air', hexBlock(onAir, { accent: tampered })],
      ['Decrypted by the receiver', hexBlock(received, { accent: tampered })],
    ]),

    tampered
      ? verdict(
          'alarm',
          'DECRYPTED CLEANLY — AND IT IS NOT WHAT WAS SENT',
          el('span', {}, [
            `The receiver read version ${metadataVersion(readingAfter.versionByte)} and a transmit power of ${readingAfter.txPowerDbm} dBm. The sender sent version ${metadataVersion(readingBefore.versionByte)} and ${readingBefore.txPowerDbm} dBm. `,
            powerShift !== 0
              ? el('strong', {
                  text: `That is a ${Math.abs(powerShift)} dB shift in the number the distance estimate is built on, and no check anywhere failed.`,
                })
              : el('strong', {
                  text: 'The version field now reads differently, and no check anywhere failed.',
                }),
          ]),
          { id: 'ex6-verdict' },
        )
      : verdict(
          'none',
          'UNTOUCHED — DECRYPTS TO WHAT WAS SENT',
          `Version ${metadataVersion(readingAfter.versionByte)}, transmit power ${readingAfter.txPowerDbm} dBm. Flip a bit above and watch what the receiver believes instead.`,
          { id: 'ex6-verdict' },
        ),

    el('div', { 'data-md-plain': toHex(plain), 'data-md-received': toHex(received), hidden: true }),

    callout(
      'note',
      'THE SPECIFICATION SAYS SO ITSELF',
      para(
        'From "Value Matching of Positive Users": "The Associated Encrypted Metadata does not have to be decrypted until a match occurs. Upon decryption, the data has to be appropriately sanitized and validated as the Associated Encrypted Metadata isn’t authenticated." The design knows; the burden is pushed to whatever reads the bytes.',
      ),
    ),

    details(
      'Why there is no error to show you',
      para(
        'An authenticated mode — AES-GCM, ChaCha20-Poly1305 — would carry a 16-byte tag and the receiver would reject this frame outright. That tag would be 16 more bytes in an advertising payload that has 4 to spare, on a radio budget measured in milliwatt-hours, broadcast every few seconds for months. The trade was deliberate.',
      ),
      list([
        'What it buys an attacker is not reading the metadata — that still needs AEMK, which needs the reported key. It is changing it, blind, in flight.',
        'A transmit-power byte shifted by 16 dB moves the estimated distance by roughly a factor of six, which is the difference between "same table" and "other side of the room".',
        'This page never invents a failure code to look thorough. There is none to show, and that is the finding.',
      ]),
    ),
  )
}
