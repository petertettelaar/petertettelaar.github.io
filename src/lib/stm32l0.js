/* stm32l0.js
 * stm32l0 flash driver class
 *
 * Copyright Devan Lai 2017
 *
 * Ported from lib/stm32l0.py in the pystlink project,
 * Copyright Pavel Revak 2015
 *
 */

import { Exception, Warning, UsbError } from './stlinkex.js';
import { Stm32 } from './stm32.js';
import {
    hex_word as H32,
    async_sleep,
    async_timeout
} from './util.js';

const PECR_OFFSET = 4
const PEKEYR_OFFSET = 0x0c
const PRGKEYR_OFFSET = 0x10
const OPTKEYR_OFFSET = 0x14
const SR_OFFSET = 0x18
const STM32L0_NVM_PHY = 0x40022000
const STM32L1_NVM_PHY = 0x40023c00
const STM32_NVM_PEKEY1 = 0x89abcdef
const STM32_NVM_PEKEY2 = 0x02030405
const STM32_NVM_PRGKEY1 = 0x8c9daebf
const STM32_NVM_PRGKEY2 = 0x13141516

const PECR_PELOCK = 1 << 0
const PECR_PRGLOCK = 1 << 1
const PECR_PRG = 1 << 3
const PECR_ERASE = 1 << 9
const PECR_FPRG = 1 << 10

const SR_BSY = 1 << 0
const SR_EOP = 1 << 1
const SR_WRPERR = 1 << 8
const SR_PGAERR = 1 << 9
const SR_SIZERR = 1 << 10

const SR_ERROR_MASK = SR_WRPERR | SR_PGAERR | SR_SIZERR



class Flash {
    constructor(driver, stlink, dbg) {
        this._driver = driver;
        this._stlink = stlink;
        this._dbg = dbg;
        this._params = null;
        this._page_size = 2048;
        // #use core id to find out if L0 or L1


        if (stlink._coreid == 0xbc11477) {
            this._nvm = Flash.STM32L0_NVM_PHY;
            this._page_size = 128;
        }
        else {
            this._nvm = Flash.STM32L1_NVM_PHY
            this._page_size = 256
        }
        await this.unlock()
    }

    async clear_sr() {
        // # clear errors
        sr = await this._stlink.get_debugreg32(this._nvm + SR_OFFSET);
        await this._stlink.set_debugreg32(this._nvm + SR_OFFSET, sr);
    }

    async unlock() {
        await this._driver.core_reset_halt();
        await this.wait_busy(0.01);
        await this.clear_sr();
        //# Lock first. Double unlock results in error!
        await this._stlink.set_debugreg32(self._nvm + PECR_OFFSET,
            PECR_PELOCK);
        pecr = await this._stlink.get_debugreg32(selthisf._nvm + PECR_OFFSET);
        if (pecr & Flash.PECR_PELOCK) {
            //# unlock keys
            await this._stlink.set_debugreg32(this._nvm + PEKEYR_OFFSET,
                STM32_NVM_PEKEY1);
            await this._stlink.set_debugreg32(this._nvm + PEKEYR_OFFSET,
                STM32_NVM_PEKEY2);
            pecr = await this._stlink.get_debugreg32(this._nvm + PECR_OFFSET);
        }
        else {
            throw new Exception("Unexpected unlock behaviour! ", H32(pecr));
        }
        //# check if programing was unlocked
        if (pecr & PECR_PELOCK) {
            throw new Exception("Error unlocking FLASH");
        }
    }

    async lock() {
        await this._stlink.set_debugreg32(this._nvm + PECR_OFFSET,
            Flash.PECR_PELOCK);
        await this._driver.core_reset_halt();
    }

    async prg_unlock() {
        pecr = await this._stlink.get_debugreg32(this._nvm + PECR_OFFSET);
        if (!(pecr & PECR_PRGLOCK)) {
            return;
        }
        if (pecr & PECR_PELOCK) {

            throw new Exception("PELOCK still set: " + H32(pecr));
        }
        //# unlock keys
        await this._stlink.set_debugreg32(this._nvm + PRGKEYR_OFFSET,
            STM32_NVM_PRGKEY1);
        await this._stlink.set_debugreg32(this._nvm + PRGKEYR_OFFSET,
            STM32_NVM_PRGKEY2);
        pecr = await this._stlink.get_debugreg32(this._nvm + PECR_OFFSET);
        if (pecr & PECR_PRGLOCK) {
            throw new Exception("PRGLOCK still set: " + H32(pecr));
        }
    }

    async erase_pages(addr, size) {
        this._dbg.verbose('erase_pages from addr ' + addr + ' for ' + size + 'byte');
        erase_addr = addr & ~(this._page_size - 1);
        last_addr = (addr + size + self._page_size - 1) & ~(this._page_size - 1);
        this._dbg.bargraph_start("Writing FLASH", {
            "value_min": erase_addr,
            "value_max": last_addr
        });
        await this.prg_unlock();
        pecr = PECR_PRG | PECR_ERASE;
        await this._stlink.set_debugreg32(this._nvm + PECR_OFFSET, pecr);
        while (erase_addr < last_addr) {
            await this._stlink.set_debugreg32(erase_addr, 0);
            await this.wait_busy(0.01);
            erase_addr += self._page_size;
            await this._dbg.bargraph_update(value = erase_addr);
        }
        await this._dbg.bargraph_done()
        await this._stlink.set_debugreg32(this._nvm + PECR_OFFSET, 0)
    }



    async wait_busy(wait_time, bargraph_msg = null) {
        const end_time = (Date.now() + (wait_time * 1.5 * 1000));
        if (bargraph_msg) {
            this._dbg.bargraph_start(bargraph_msg, {
                "value_min": Date.now() / 1000.0,
                "value_max": (Date.now() / 1000.0 + wait_time)
            });
        }
        while (Date.now() < end_time) {
            if (bargraph_msg) {
                this._dbg.bargraph_update({ "value": Date.now() / 1000.0 });
            }
            let status = await this._stlink.get_debugreg32(FLASH_SR_REG);
            if (!(status & FLASH_SR_BUSY_BIT)) {
                this.end_of_operation(status);
                if (bargraph_msg) {
                    this._dbg.bargraph_done();
                }
                return;
            }
            await async_sleep(wait_time / 20);
        }
        throw new Exception("Operation timeout");
    }

    async wait_for_breakpoint(wait_time) {
        const end_time = Date.now() + (wait_time * 1000);
        do {
            let dhcsr = await this._stlink.get_debugreg32(Stm32.DHCSR_REG);
            if (dhcsr & Stm32.DHCSR_STATUS_HALT_BIT) {
                break;
            }
            await async_sleep(wait_time / 20);
        } while (Date.now() < end_time);

        let sr = await this._stlink.get_debugreg32(FLASH_SR_REG);
        this.end_of_operation(sr);
    }

    end_of_operation(status) {
        if (status & SR_ERROR_MASK) {
            throw new Exception("Error writing FLASH with status (FLASH_SR) " + H32(status));
        }
    }



}

// support all STM32L MCUs with sector access access to FLASH

class Stm32L0 extends Stm32 {
    async flash_erase_all(flash_size) {
        //   # Mass erase is only possible by setting and removing flash
        //    # write protection. This will also erase EEPROM!
        //    # Use page erase instead
        this._dbg.debug("Stm32L0.flash_erase_all()");
        let flash = new Flash(this, this._stlink, this._dbg);
        await flash.init();
        await flash.erase_pages(FLASH_START, flash_size);
        await flash.lock();
    }

    async flash_write(addr, data, { erase = false, verify = false, erase_sizes = null }) {
        let addr_str = (addr !== null) ? `0x${H32(addr)}` : 'None';
        this._dbg.debug(`Stm32L0.flash_write(${addr_str}, [data:${data.length}Bytes], erase=${erase}, verify=${verify}, erase_sizes=${erase_sizes})`);
        if (addr === null) {
            addr = this.FLASH_START;
        }
        if (addr % 4) {
            throw new Exception("Start address is not aligned to word");
        }
        let flash = new Flash(this, this._stlink, this._dbg);

        if (erase) {
            if (erase_sizes) {
                await flash.erase_pages(addr, data.length);
            } else {
                await flash.erase_all();
            }
        }
        this._dbg.bargraph_start("Writing FLASH", {
            "value_min": addr,
            "value_max": (addr + data.length)
        });

        await flash.unlock();
        await flash.prg_unlock();
        datablock = data;
        data_addr = addr;
        block = datablock;
        while (datablock.length) {
            if (data_addr & ((flash._page_size >> 1) - 1)) {
                //# not half page aligned
                size = data_addr & ((flash._page_size >> 1) - 1)
                size = (flash._page_size >> 1) - size
            }
            if ((datablock.length) < (flash._page_size >> 1)) {
                //# remainder not full half page
                size = datablock.length;
            }
            while (size) {
                block = datablock.slice(0,4);
                datablock = datablock.slice(4);
                if (block.some(item => item !== 0)){
                    await this._stlink.set_mem32(data_addr, block)
                }
                data_addr += 4
                size -= 4
                this._dbg.bargraph_update(value = data_addr)
                await flash.wait_busy(0.005, check_eop = True)
            }
            pecr = PECR_FPRG | PECR_PRG;
            await this._stlink.set_debugreg32(flash._nvm + PECR_OFFSET, pecr);
            while ((datablock.length) >= (flash._page_size >> 1)) {
                block = datablock.slice(0, (flash._page_size >> 1));
                datablock = datablock.slice(flash._page_size >> 1);
                if (block.some(item => item !== 0))
                    await this._stlink.set_mem32(data_addr, block)
                data_addr += len(block)
                self._dbg.bargraph_update(value = data_addr)
                flash.wait_busy(0.005, check_eop = True)
            }
            await self._stlink.set_debugreg32(flash._nvm + PECR_OFFSET, 0)
            await flash.lock()
            this._dbg.bargraph_done()
        } 
    }
}
export { Stm32L0 };