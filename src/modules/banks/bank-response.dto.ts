import { ApiProperty } from '@nestjs/swagger';

export class BankResponseDto {
  @ApiProperty({ example: '970436' })
  bin!: string;

  @ApiProperty({ example: 'VCB' })
  code!: string;

  @ApiProperty({ example: 'Vietcombank' })
  shortName!: string;

  @ApiProperty()
  name!: string;
}
