import { EntryPoint, EntryPoint__factory, UserOperationStruct } from '@account-abstraction/contracts'
import { hexConcat, hexlify, parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestCoin, TestCoin__factory, TestRulesAccount, TestRulesAccountDeployer, TestRulesAccountDeployer__factory, TestRulesAccount__factory } from '../src/types'
import { isGeth, opcodeScanner } from '../src/opcodeScanner'

describe('opcode banning', () => {
  let deployer: TestRulesAccountDeployer
  let paymaster: TestRulesAccount
  let entryPoint: EntryPoint
  let token: TestCoin

  async function testUserOp (validateRule: string = '', initFunc?: string, pmRule?: string): Promise<any> {
    return await opcodeScanner(await createTestUserOp(validateRule, initFunc, pmRule), entryPoint)
  }

  async function createTestUserOp (validateRule: string = '', initFunc?: string, pmRule?: string): Promise<UserOperationStruct> {
    if (initFunc === undefined) {
      initFunc = deployer.interface.encodeFunctionData('create', ['', token.address])
    }

    const initCode = hexConcat([
      deployer.address,
      initFunc
    ])
    const paymasterAndData = pmRule == null ? '0x' : hexConcat([paymaster.address, Buffer.from(pmRule)])
    let signature: string
    if (validateRule.startsWith('deadline:')) {
      signature = hexlify(validateRule.slice(9))
    } else {
      signature = hexlify(Buffer.from(validateRule))
    }
    const sender = await deployer.callStatic.create('', token.address)
    return {
      sender,
      initCode,
      signature,
      nonce: 0,
      paymasterAndData,
      callData: '0x',
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0
    }
  }

  before(async function () {
    const ethersSigner = ethers.provider.getSigner()
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    paymaster = await new TestRulesAccount__factory(ethersSigner).deploy()
    await entryPoint.depositTo(paymaster.address, { value: parseEther('0.1') })
    await paymaster.addStake(entryPoint.address, { value: parseEther('0.1') })
    deployer = await new TestRulesAccountDeployer__factory(ethersSigner).deploy()
    token = await new TestCoin__factory(ethersSigner).deploy()

    if (!await isGeth(ethers.provider)) {
      console.log('opcode banning tests can only run with geth')
      this.skip()
    }
  })
  it('should accept plain request', async () => {
    await testUserOp()
  })
  it('test sanity: reject unknown rule', async () => {
    expect(await testUserOp('<unknown-rule>')
      .catch(e => e.message)).to.match(/unknown rule/)
  })
  it('should fail with bad opcode in ctr', async () => {
    expect(await testUserOp('',
      deployer.interface.encodeFunctionData('create', ['coinbase', token.address]))
      .catch(e => e.message)).to.match(/account uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in paymaster', async () => {
    expect(await testUserOp('', undefined, 'coinbase')
      .catch(e => e.message)).to.match(/paymaster uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in validation', async () => {
    expect(await testUserOp('blockhash')
      .catch(e => e.message)).to.match(/account uses banned opcode: BLOCKHASH/)
  })
  it('should fail if creating too many', async () => {
    expect(await testUserOp('create2')
      .catch(e => e.message)).to.match(/initCode with too many CREATE2/)
  })
  it('should succeed if referencing self token balance', async () => {
    await testUserOp('balance-self')
  })
  it('should fail if referencing other token balance', async () => {
    expect(await testUserOp('balance-1').catch(e => e)).to.match(/forbidden read/)
  })
})
